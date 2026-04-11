"""任务服务层 — CRUD + 状态机逻辑。

所有业务规则集中在此：
- 创建任务 → 事件写入 outbox 表（同一事务）
- 状态流转 → 校验合法性 + SELECT FOR UPDATE 防并发 + outbox 事件
- 查询、过滤、聚合

事件投递由 OutboxRelay worker 异步完成，保证 DB/Event 原子一致。
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..channels.feishu import FeishuChannel
from ..config import get_settings
from ..models.outbox import OutboxEvent
from ..models.task import Task, TaskState, STATE_TRANSITIONS, TERMINAL_STATES
from .event_bus import (
    TOPIC_TASK_CREATED,
    TOPIC_TASK_STATUS,
    TOPIC_TASK_COMPLETED,
    TOPIC_TASK_DISPATCH,
)
from .task_workspace import (
    archive_task_workspace,
    build_workspace_meta,
    generate_task_code,
    push_workspace_notification,
    reactivate_task_workspace,
    remove_task_workspace,
    set_workspace_risk_control,
    sync_workspace_for_task,
)

log = logging.getLogger("agentorchestrator.task_service")


def _split_csv_values(raw: str | None) -> set[str]:
    return {item.strip() for item in str(raw or "").split(",") if item.strip()}


class TaskService:
    """AGENTORCHESTRATOR 中心与专家协作任务服务。"""

    def __init__(self, db: AsyncSession, event_bus=None):
        self.db = db
        # event_bus 保留用于 request_dispatch 等直接发布场景
        self.bus = event_bus

    def _should_send_feishu_report(self, *, event: str, agent: str) -> tuple[bool, dict[str, Any]]:
        settings = get_settings()
        allowed_agents = _split_csv_values(settings.feishu_report_agents)
        allowed_events = _split_csv_values(settings.feishu_report_events)
        normalized_agent = str(agent or "system").strip() or "system"
        enabled = bool(settings.notification_enabled and settings.feishu_report_enabled and settings.feishu_report_webhook)
        if not enabled:
            return False, {
                "enabled": False,
                "channel": "feishu",
                "webhook_configured": bool(settings.feishu_report_webhook),
                "allowed_agents": sorted(allowed_agents),
                "allowed_events": sorted(allowed_events),
                "skip_reason": "feishu_reporting_disabled",
            }
        if allowed_events and event not in allowed_events:
            return False, {
                "enabled": True,
                "channel": "feishu",
                "webhook_configured": True,
                "allowed_agents": sorted(allowed_agents),
                "allowed_events": sorted(allowed_events),
                "skip_reason": f"event_not_enabled:{event}",
            }
        if allowed_agents and normalized_agent not in allowed_agents:
            return False, {
                "enabled": True,
                "channel": "feishu",
                "webhook_configured": True,
                "allowed_agents": sorted(allowed_agents),
                "allowed_events": sorted(allowed_events),
                "skip_reason": f"agent_not_enabled:{normalized_agent}",
            }
        return True, {
            "enabled": True,
            "channel": "feishu",
            "webhook_configured": True,
            "allowed_agents": sorted(allowed_agents),
            "allowed_events": sorted(allowed_events),
            "skip_reason": "",
        }

    def _render_feishu_report_content(
        self,
        task: Task,
        *,
        event: str,
        agent: str,
        summary: str,
        payload: dict[str, Any] | None = None,
    ) -> str:
        settings = get_settings()
        payload = payload or {}
        task_data = task.to_dict()
        workspace = ((task.meta or {}).get("workspace") or {})
        lines = [
            f"**任务代号**：`{task_data.get('taskCode', '')}`",
            f"**任务标题**：{task.title}",
            f"**事件类型**：`{event}`",
            f"**执行 Agent**：`{agent or 'system'}`",
            f"**当前状态**：`{task.state.value}`",
            f"**任务分类**：`{workspace.get('task_kind', 'standard')}`",
            f"**归档状态**：`{workspace.get('archive_status', 'hot')}`",
            f"**处理位置**：`{workspace.get('processing_location', 'hot')}`",
            f"**摘要**：{summary or '无'}",
        ]
        if not settings.feishu_report_include_summary_only and payload:
            payload_keys = "、".join(sorted(str(key) for key in payload.keys())) or "无"
            lines.append(f"**附加字段**：{payload_keys}")
        next_action = str(
            workspace.get("latest_handoff")
            or ((workspace.get("new_refresh") or {}).get("recommended_action"))
            or ""
        )
        if next_action:
            lines.append(f"**建议下一步**：{next_action}")
        content = "\n".join(lines)
        max_chars = max(200, int(settings.feishu_report_max_content_chars))
        return content[:max_chars]

    async def _maybe_send_feishu_report(
        self,
        task: Task,
        *,
        event: str,
        agent: str,
        summary: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        should_send, policy = self._should_send_feishu_report(event=event, agent=agent)
        if not should_send:
            return

        settings = get_settings()
        normalized_agent = str(agent or "system").strip() or "system"
        task_data = task.to_dict()
        content = self._render_feishu_report_content(
            task,
            event=event,
            agent=normalized_agent,
            summary=summary,
            payload=payload,
        )
        sent = FeishuChannel.send(
            webhook=settings.feishu_report_webhook,
            title=f"任务汇报｜{task.title[:40]}",
            content=content,
            extra={
                "task_id": str(task.task_id),
                "task_code": task_data.get("taskCode", ""),
                "event": event,
                "agent": normalized_agent,
            },
        )

        meta = dict(task.meta or {})
        workspace = dict(meta.get("workspace") or {})
        workspace["feishu_reporting"] = {
            **dict(workspace.get("feishu_reporting") or {}),
            **policy,
            "last_status": "sent" if sent else "failed",
            "last_event": event,
            "last_agent": normalized_agent,
            "last_summary": summary,
            "last_reported_at": datetime.now(timezone.utc).isoformat(),
            "last_content_preview": content[:240],
        }
        meta["workspace"] = workspace
        task.meta = meta
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.report.feishu.sent" if sent else "task.report.feishu.failed",
            summary="飞书群汇报已发送。" if sent else "飞书群汇报发送失败。",
            agent=normalized_agent,
            payload={
                "report_event": event,
                "status": "sent" if sent else "failed",
                "channel": "feishu",
            },
            ledger_name="reports",
        )
        await self.db.commit()

    # ── 创建 ──

    async def create_task(
        self,
        title: str,
        description: str = "",
        priority: str = "中",
        assignee_org: str | None = None,
        creator: str = "system",
        tags: list[str] | None = None,
        initial_state: TaskState = TaskState.ControlCenter,
        meta: dict | None = None,
    ) -> Task:
        """创建任务，事件写入 outbox 表（同一事务原子提交）。"""
        now = datetime.now(timezone.utc)
        trace_id = str(uuid.uuid4())
        target_org = Task.org_for_state(initial_state, assignee_org)
        task_meta = meta or {}

        task = Task(
            trace_id=trace_id,
            title=title,
            description=description,
            priority=priority,
            state=initial_state,
            assignee_org=assignee_org,
            creator=creator,
            tags=tags or [],
            org=target_org,
            owner=creator,
            now=description or "任务创建",
            target_dept=assignee_org or "",
            flow_log=[
                {
                    "from": None,
                    "to": initial_state.value,
                    "agent": "system",
                    "reason": "任务创建",
                    "remark": "任务创建",
                    "ts": now.isoformat(),
                    "at": now.isoformat(),
                }
            ],
            progress_log=[],
            todos=[],
            scheduler={},
            meta=task_meta,
        )
        self.db.add(task)
        await self.db.flush()

        existing_codes = await self._list_existing_task_codes()
        task_code = generate_task_code(existing_codes, creator=creator)
        task.meta = build_workspace_meta(
            task_id=str(task.task_id),
            task_code=task_code,
            title=title,
            description=description,
            creator=creator,
            state=initial_state.value,
            priority=priority,
            assignee_org=assignee_org,
            trace_id=trace_id,
            created_at=now.isoformat(),
            existing_meta=task_meta,
        )
        task.meta = self._sync_workspace(
            task,
            event="task.created",
            summary=description or "任务已创建，等待拆解与推进。",
            agent=creator or "system",
            payload={"task_code": task_code, "initial_state": initial_state.value},
        )

        # 事件写入 outbox — 与 task 同一事务，原子提交
        outbox = OutboxEvent(
            topic=TOPIC_TASK_CREATED,
            trace_id=trace_id,
            event_type="task.created",
            producer="task_service",
            payload={
                "task_id": str(task.task_id),
                "title": title,
                "state": initial_state.value,
                "priority": priority,
                "assignee_org": assignee_org,
            },
        )
        self.db.add(outbox)

        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.created",
            agent=creator or "system",
            summary=description or "任务已创建，等待拆解与推进。",
            payload={"initial_state": initial_state.value, "priority": priority},
        )
        log.info(f"Created task {task.task_id}: {title} [{initial_state.value}]")
        return task

    # ── 状态流转 ──

    async def transition_state(
        self,
        task_id: uuid.UUID,
        new_state: TaskState,
        agent: str = "system",
        reason: str = "",
    ) -> Task:
        """执行状态流转。SELECT FOR UPDATE 防止并发 flow_log 丢失。"""
        # 行级排他锁 — 串行化同一任务的并发写入
        stmt = select(Task).where(Task.task_id == task_id).with_for_update()
        result = await self.db.execute(stmt)
        task = result.scalar_one_or_none()
        if task is None:
            raise ValueError(f"Task not found: {task_id}")

        old_state = task.state

        # 校验合法流转
        allowed = STATE_TRANSITIONS.get(old_state, set())
        if new_state not in allowed:
            raise ValueError(
                f"Invalid transition: {old_state.value} → {new_state.value}. "
                f"Allowed: {[s.value for s in allowed]}"
            )

        task.state = new_state
        task.org = Task.org_for_state(new_state, task.assignee_org)
        if reason:
            task.now = reason
        task.updated_at = datetime.now(timezone.utc)

        # 在行锁保护下安全追加 flow_log
        event_time = datetime.now(timezone.utc).isoformat()
        flow_entry = {
            "from": old_state.value,
            "to": new_state.value,
            "agent": agent,
            "reason": reason,
            "remark": reason,
            "ts": event_time,
            "at": event_time,
        }
        if task.flow_log is None:
            task.flow_log = []
        task.flow_log = [*task.flow_log, flow_entry]

        task.meta = self._sync_workspace(
            task,
            event="task.state.changed",
            summary=reason or f"任务状态已从 {old_state.value} 更新为 {new_state.value}",
            agent=agent,
            payload={"from": old_state.value, "to": new_state.value, "reason": reason},
        )

        # 事件写入 outbox（同一事务）
        topic = TOPIC_TASK_COMPLETED if new_state in TERMINAL_STATES else TOPIC_TASK_STATUS
        outbox = OutboxEvent(
            topic=topic,
            trace_id=str(task.trace_id),
            event_type=f"task.state.{new_state.value}",
            producer=agent,
            payload={
                "task_id": str(task_id),
                "from": old_state.value,
                "to": new_state.value,
                "reason": reason,
                "assignee_org": task.assignee_org,
            },
        )
        self.db.add(outbox)

        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.state.changed",
            agent=agent,
            summary=reason or f"任务状态已从 {old_state.value} 更新为 {new_state.value}",
            payload={"from": old_state.value, "to": new_state.value},
        )
        log.info(f"Task {task_id} state: {old_state.value} → {new_state.value} by {agent}")
        return task

    # ── 派发请求 ──

    async def request_dispatch(
        self,
        task_id: uuid.UUID,
        target_agent: str,
        message: str = "",
    ):
        """发布 task.dispatch 事件到 outbox，由 OutboxRelay 投递后交给目标中心或专家消费。"""
        task = await self._get_task(task_id)
        outbox = OutboxEvent(
            topic=TOPIC_TASK_DISPATCH,
            trace_id=str(task.trace_id),
            event_type="task.dispatch.request",
            producer="task_service",
            payload={
                "task_id": str(task_id),
                "agent": target_agent,
                "message": message,
                "state": task.state.value,
            },
        )
        self.db.add(outbox)
        await self.db.commit()
        log.info(f"Dispatch requested: task {task_id} → target {target_agent}")

    # ── 进度/备注更新 ──

    async def add_progress(
        self,
        task_id: uuid.UUID,
        agent: str,
        content: str,
    ) -> Task:
        task = await self._get_task(task_id)
        event_time = datetime.now(timezone.utc).isoformat()
        entry = {
            "agent": agent,
            "agentLabel": agent,
            "content": content,
            "text": content,
            "ts": event_time,
            "at": event_time,
        }
        if task.progress_log is None:
            task.progress_log = []
        task.progress_log = [*task.progress_log, entry]
        task.now = content or task.now
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.progress.appended",
            summary=content,
            agent=agent,
            payload={"content": content},
            ledger_name="progress",
        )
        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.progress.appended",
            agent=agent,
            summary=content,
            payload={"content_length": len(content or "")},
        )
        return task

    async def update_todos(
        self,
        task_id: uuid.UUID,
        todos: list[dict],
    ) -> Task:
        task = await self._get_task(task_id)
        task.todos = todos
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.todos.updated",
            summary=f"待办已更新，共 {len(todos)} 项。",
            payload={"todo_total": len(todos)},
            ledger_name="todos",
        )
        await self.db.commit()
        return task

    async def update_scheduler(
        self,
        task_id: uuid.UUID,
        scheduler: dict,
    ) -> Task:
        task = await self._get_task(task_id)
        task.scheduler = scheduler
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.scheduler.updated",
            summary="任务排期信息已更新。",
            payload={"scheduler": scheduler},
            ledger_name="scheduler",
        )
        await self.db.commit()
        return task

    async def update_workspace_meta(
        self,
        task_id: uuid.UUID,
        patch: dict[str, Any],
        agent: str = "system",
        summary: str = "任务工作区元数据已更新。",
    ) -> Task:
        task = await self._get_task(task_id)
        meta = dict(task.meta or {})
        workspace = dict(meta.get("workspace") or {})
        workspace.update(patch or {})
        meta["workspace"] = workspace
        task.meta = meta
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.workspace.updated",
            summary=summary,
            agent=agent,
            payload={"patch": patch},
            ledger_name="workspace",
        )
        await self.db.commit()
        return task

    async def create_workspace_notification(
        self,
        task_id: uuid.UUID,
        *,
        title: str,
        message: str,
        source: str = "system",
        kind: str = "info",
        severity: str = "info",
        requires_ack: bool = False,
        meta: dict[str, Any] | None = None,
    ) -> Task:
        task = await self._get_task(task_id)
        task.updated_at = datetime.now(timezone.utc)
        task.meta = push_workspace_notification(
            task.to_dict(),
            title=title,
            message=message,
            source=source,
            kind=kind,
            severity=severity,
            requires_ack=requires_ack,
            meta=meta,
        )
        task.meta = self._sync_workspace(
            task,
            event="task.notification.created",
            summary=title,
            agent=source,
            payload={
                "kind": kind,
                "severity": severity,
                "message": message,
                "requires_ack": requires_ack,
                "meta": meta or {},
            },
            ledger_name="notifications",
        )
        await self.db.commit()
        return task

    async def update_workspace_risk_control(
        self,
        task_id: uuid.UUID,
        *,
        status: str,
        level: str,
        summary: str,
        requested_by: str = "system",
        requires_user_confirmation: bool = False,
        confirmation_channel: str = "",
        approval_status: str = "not_required",
        approval_reason: str = "",
        approved_by: str = "",
        operations: list[dict[str, Any]] | None = None,
    ) -> Task:
        task = await self._get_task(task_id)
        task.updated_at = datetime.now(timezone.utc)
        task.meta = set_workspace_risk_control(
            task.to_dict(),
            status=status,
            level=level,
            summary=summary,
            requested_by=requested_by,
            requires_user_confirmation=requires_user_confirmation,
            confirmation_channel=confirmation_channel,
            approval_status=approval_status,
            approval_reason=approval_reason,
            approved_by=approved_by,
            operations=operations,
        )
        task.meta = self._sync_workspace(
            task,
            event="task.risk_control.updated",
            summary=summary or "风险控制状态已更新。",
            agent=requested_by,
            payload=((task.meta or {}).get("workspace") or {}).get("risk_control", {}),
            ledger_name="risk_control",
        )
        await self.db.commit()
        return task

    async def archive_workspace(self, task_id: uuid.UUID, agent: str = "system") -> Task:
        task = await self._get_task(task_id)
        task.archived = True
        task.updated_at = datetime.now(timezone.utc)
        task.meta = archive_task_workspace(task.to_dict())
        task.meta = self._sync_workspace(
            task,
            event="task.workspace.archive.confirmed",
            summary="任务工作区已归档到冷存储。",
            agent=agent,
            payload={"archive_status": ((task.meta or {}).get("workspace") or {}).get("archive_status", "cold")},
            ledger_name="archive",
        )
        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.workspace.archive.confirmed",
            agent=agent,
            summary="任务工作区已完成归档。",
            payload={"archive_status": ((task.meta or {}).get("workspace") or {}).get("archive_status", "")},
        )
        return task

    async def reactivate_workspace(
        self,
        task_id: uuid.UUID,
        agent: str = "system",
        move_to_hot: bool | None = None,
    ) -> Task:
        task = await self._get_task(task_id)
        task.archived = False
        task.updated_at = datetime.now(timezone.utc)
        task.meta = reactivate_task_workspace(task.to_dict(), move_to_hot=move_to_hot)
        task.meta = self._sync_workspace(
            task,
            event="task.workspace.reactivated.confirmed",
            summary="任务工作区已重新激活。",
            agent=agent,
            payload={"move_to_hot": move_to_hot},
            ledger_name="archive",
        )
        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.workspace.reactivated.confirmed",
            agent=agent,
            summary="任务工作区已重新激活。",
            payload={"processing_location": ((task.meta or {}).get("workspace") or {}).get("processing_location", "")},
        )
        return task

    async def run_watchdog(self, task_id: uuid.UUID, agent: str = "watchdog") -> Task:
        task = await self._get_task(task_id)
        task.updated_at = datetime.now(timezone.utc)
        task.meta = self._sync_workspace(
            task,
            event="task.watchdog.sync",
            summary="任务看门狗巡检已完成。",
            agent=agent,
            payload={"watchdog": (task.meta or {}).get("workspace", {}).get("watchdog", {})},
            ledger_name="watchdog",
        )
        await self.db.commit()
        await self._maybe_send_feishu_report(
            task,
            event="task.watchdog.sync",
            agent=agent,
            summary="任务看门狗巡检已完成。",
            payload={"watchdog_status": ((task.meta or {}).get("workspace") or {}).get("watchdog", {}).get("status", "unknown")},
        )
        return task

    # ── 查询 ──

    async def delete_task(
        self,
        task_id: uuid.UUID,
        *,
        agent: str = "system",
        reason: str = "",
        delete_workspace: bool = True,
    ) -> dict[str, Any]:
        task = await self._get_task(task_id)
        original_meta = dict(task.meta or {})
        removed_workspace_paths: list[str] = []
        if delete_workspace:
            updated_meta = remove_task_workspace(task.to_dict())
            removed_workspace_paths = list(((updated_meta.get("workspace") or {}).get("deleted_paths") or []))
            task.meta = updated_meta
            task.updated_at = datetime.now(timezone.utc)
        task_data = task.to_dict()
        await self.db.delete(task)
        await self.db.commit()
        return {
            "task_id": str(task_id),
            "title": task.title,
            "agent": agent,
            "reason": reason,
            "deleted_workspace": bool(delete_workspace),
            "removed_workspace_paths": removed_workspace_paths,
            "workspace": (original_meta.get("workspace") or {}),
            "task": task_data,
        }

    async def get_task(self, task_id: uuid.UUID) -> Task:
        return await self._get_task(task_id)

    async def list_tasks(
        self,
        state: TaskState | None = None,
        assignee_org: str | None = None,
        priority: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Task]:
        stmt = select(Task)
        conditions = []
        if state is not None:
            conditions.append(Task.state == state)
        if assignee_org is not None:
            conditions.append(Task.assignee_org == assignee_org)
        if priority is not None:
            conditions.append(Task.priority == priority)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(Task.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_live_status(self) -> dict[str, Any]:
        """生成统一的全局实时状态数据。"""
        tasks = await self.list_tasks(limit=200)
        active_tasks = {}
        completed_tasks = {}
        for t in tasks:
            d = t.to_dict()
            if t.state in TERMINAL_STATES:
                completed_tasks[str(t.task_id)] = d
            else:
                active_tasks[str(t.task_id)] = d
        return {
            "tasks": active_tasks,
            "completed_tasks": completed_tasks,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }

    async def count_tasks(self, state: TaskState | None = None) -> int:
        stmt = select(func.count(Task.task_id))
        if state is not None:
            stmt = stmt.where(Task.state == state)
        result = await self.db.execute(stmt)
        return result.scalar_one()

    # ── 内部 ──

    async def _list_existing_task_codes(self) -> list[str]:
        stmt = select(Task.meta)
        result = await self.db.execute(stmt)
        rows = result.scalars().all()
        codes: list[str] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            workspace = item.get("workspace") or {}
            code = workspace.get("task_code")
            if code:
                codes.append(str(code))
        return codes

    def _sync_workspace(
        self,
        task: Task,
        event: str,
        summary: str,
        agent: str = "system",
        payload: dict[str, Any] | None = None,
        ledger_name: str = "events",
    ) -> dict[str, Any]:
        return sync_workspace_for_task(
            task.to_dict(),
            event=event,
            summary=summary,
            agent=agent,
            payload=payload,
            ledger_name=ledger_name,
        )

    async def _get_task(self, task_id: uuid.UUID) -> Task:
        task = await self.db.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        return task
