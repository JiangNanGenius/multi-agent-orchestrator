"""核心编排器 Worker。

监听 topic:
- task.created → 自动派发给总控中心
- task.status → 处理各种状态变更，自动派发下游中心或专家
- task.completed → 记录任务完成日志
- task.stalled → 处理停滞任务（重试 → 升级 → 阻塞）

附加定时任务:
- _check_stalled → 每 60s 扫描 Doing / Next 状态超时任务，发布 task.stalled 事件

这是系统的核心编排器，负责驱动中心与专家协作流程。
得益于 Redis Streams ACK 机制：即使 worker 崩溃，未 ACK 的事件
会被其他消费者自动认领，永不丢失。
"""

import asyncio
import logging
import signal
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from ..config import get_settings
from ..db import async_session
from ..models.task import Task, TaskState, STATE_AGENT_MAP, ORG_AGENT_MAP
from ..services.event_bus import (
    EventBus,
    TOPIC_TASK_CREATED,
    TOPIC_TASK_STATUS,
    TOPIC_TASK_DISPATCH,
    TOPIC_TASK_COMPLETED,
    TOPIC_TASK_STALLED,
    TOPIC_TASK_ESCALATED,
)
from ..services.task_service import TaskService

log = logging.getLogger("agentorchestrator.orchestrator")

GROUP = "orchestrator"
CONSUMER = "orch-1"

# 停滞恢复配置
MAX_STALL_RETRIES = 2        # 最大重试次数
MAX_ESCALATION_LEVEL = 4     # 最大升级层级（包含 ControlCenter 兜底层）
STALL_RETRY_BACKOFF = [30, 60, 120]  # 重试退避时间（秒）

# 停滞检测配置
STALL_CHECK_INTERVAL_SEC = 60   # 检查间隔（秒）
STALL_THRESHOLD_SEC = 600       # 超过 10 分钟无心跳视为停滞

# 升级路径：任务卡住时按中心层级逐级升级
_ESCALATION_PATH = {
    "Doing": TaskState.Assigned,              # 专家执行卡住 → 回到调度中心重新派发
    "Next": TaskState.Assigned,
    "Assigned": TaskState.ReviewCenter,       # 调度中心卡住 → 回到评审中心复核
    "ReviewCenter": TaskState.PlanCenter,     # 评审中心卡住 → 回到规划中心重整方案
    "PlanCenter": TaskState.ControlCenter,    # 规划中心卡住 → 回到总控中心重新决策
}

# 需要监听的 topics
WATCHED_TOPICS = [
    TOPIC_TASK_CREATED,
    TOPIC_TASK_STATUS,
    TOPIC_TASK_COMPLETED,
    TOPIC_TASK_STALLED,
]


class OrchestratorWorker:
    """事件驱动的编排器 Worker。"""

    def __init__(self):
        self.bus = EventBus()
        self._running = False
        self._stall_checker_task: asyncio.Task | None = None

    async def start(self):
        """启动 worker 主循环。"""
        await self.bus.connect()

        # 确保所有消费者组
        for topic in WATCHED_TOPICS:
            await self.bus.ensure_consumer_group(topic, GROUP)

        self._running = True
        log.info("🏛️ Orchestrator worker started")

        # 先处理崩溃遗留的 pending 事件
        await self._recover_pending()

        # 启动停滞检测后台任务
        self._stall_checker_task = asyncio.create_task(self._stall_check_loop())

        while self._running:
            try:
                await self._poll_cycle()
            except Exception as e:
                log.error(f"Orchestrator poll error: {e}", exc_info=True)
                await asyncio.sleep(2)

    async def stop(self):
        self._running = False
        if self._stall_checker_task:
            self._stall_checker_task.cancel()
        await self.bus.close()
        log.info("Orchestrator worker stopped")

    async def _recover_pending(self):
        """恢复崩溃前未 ACK 的事件。"""
        for topic in WATCHED_TOPICS:
            events = await self.bus.claim_stale(
                topic, GROUP, CONSUMER, min_idle_ms=30000, count=50
            )
            if events:
                log.info(f"Recovering {len(events)} stale events from {topic}")
                for entry_id, event in events:
                    try:
                        await self._handle_event(topic, entry_id, event)
                        await self.bus.ack(topic, GROUP, entry_id)
                    except Exception as e:
                        log.error(
                            f"Error recovering stale event {entry_id} from {topic}: {e}",
                            exc_info=True,
                        )

    async def _poll_cycle(self):
        """一次轮询周期：多 topic 同时消费，按 task_id 分组并行处理。"""
        events = await self.bus.consume_multi(
            WATCHED_TOPICS, GROUP, CONSUMER, count=20, block_ms=500
        )
        if not events:
            return

        # 按 task_id 分组：同一任务串行，不同任务并行
        by_task: dict[str, list[tuple[str, str, dict]]] = {}
        for topic, entry_id, event in events:
            task_id = event.get("payload", {}).get("task_id", entry_id)
            by_task.setdefault(task_id, []).append((topic, entry_id, event))

        async def _process_task_events(task_events: list[tuple[str, str, dict]]):
            for topic, entry_id, event in task_events:
                try:
                    await self._handle_event(topic, entry_id, event)
                    await self.bus.ack(topic, GROUP, entry_id)
                except Exception as e:
                    log.error(
                        f"Error handling event {entry_id} from {topic}: {e}",
                        exc_info=True,
                    )

        await asyncio.gather(*[
            _process_task_events(evts) for evts in by_task.values()
        ])

    async def _handle_event(self, topic: str, entry_id: str, event: dict):
        """根据 topic 和 event_type 分发处理。"""
        event_type = event.get("event_type", "")
        trace_id = event.get("trace_id", "")
        payload = event.get("payload", {})

        log.info(f"📨 {topic}/{event_type} trace={trace_id}")

        if topic == TOPIC_TASK_CREATED:
            await self._on_task_created(payload, trace_id)
        elif topic == TOPIC_TASK_STATUS:
            await self._on_task_status(
                event_type,
                payload,
                trace_id,
                producer=event.get("producer", ""),
            )
        elif topic == TOPIC_TASK_COMPLETED:
            await self._on_task_completed(payload, trace_id)
        elif topic == TOPIC_TASK_STALLED:
            await self._on_task_stalled(payload, trace_id)

    async def _on_task_created(self, payload: dict, trace_id: str):
        """任务创建后自动派发给总控中心处理入口决策。"""
        task_id = payload.get("task_id")
        state = payload.get("state", TaskState.ControlCenter.value)
        agent = STATE_AGENT_MAP.get(TaskState(state), "control_center")

        await self.bus.publish(
            topic=TOPIC_TASK_DISPATCH,
            trace_id=trace_id,
            event_type="task.dispatch.request",
            producer="orchestrator",
            payload={
                "task_id": task_id,
                "agent": agent,
                "state": state,
                "message": f"新任务已创建: {payload.get('title', '')}",
            },
        )

    async def _on_task_status(
        self,
        event_type: str,
        payload: dict,
        trace_id: str,
        producer: str = "",
    ):
        """状态变更 → 自动派发下一个 agent。"""
        task_id = payload.get("task_id")
        new_state_str = payload.get("to", "")
        from_state_str = payload.get("from", "")
        reason = payload.get("reason", "") or ""

        try:
            new_state = TaskState(new_state_str)
        except ValueError:
            log.warning(f"Unknown state: {new_state_str}")
            return

        # 如果新状态有对应 agent，自动派发
        agent = STATE_AGENT_MAP.get(new_state)

        # 如果进入 Assigned 状态，需要区分“升级回调度中心”与“派发到专家执行”两类路径
        if new_state == TaskState.Assigned:
            escalated_back_to_dispatch = (
                from_state_str in {TaskState.Doing.value, TaskState.Next.value}
                or (producer == "orchestrator" and "升级" in reason)
            )
            if escalated_back_to_dispatch:
                agent = "dispatch_center"
            else:
                org = payload.get("assignee_org", "")
                if org:
                    agent = ORG_AGENT_MAP.get(org, agent)
                else:
                    # assignee_org 为空时，回退到调度中心手动分配
                    log.warning(
                        f"Task {task_id} entering Assigned without assignee_org, "
                        f"dispatching to dispatch_center for manual routing"
                    )
                    agent = "dispatch_center"

        if agent:
            await self.bus.publish(
                topic=TOPIC_TASK_DISPATCH,
                trace_id=trace_id,
                event_type="task.dispatch.request",
                producer="orchestrator",
                payload={
                    "task_id": task_id,
                    "agent": agent,
                    "state": new_state_str,
                    "message": reason or f"任务已流转到 {new_state_str}",
                    "assignee_org": payload.get("assignee_org", ""),
                    "from": from_state_str,
                    "to": new_state_str,
                },
            )

    async def _on_task_completed(self, payload: dict, trace_id: str):
        """任务完成 → 记录日志。"""
        task_id = payload.get("task_id")
        log.info(f"🎉 Task {task_id} completed. trace={trace_id}")

    async def _on_task_stalled(self, payload: dict, trace_id: str):
        """任务停滞 → 自动重试或升级。

        恢复策略：
        1. 第一次停滞：在当前状态重新派发对应中心或专家（重试）
        2. 重试耗尽：按中心层级逐级升级（如专家 → 调度中心 → 评审中心）
        3. 升级到顶（总控中心）仍失败：标记 Blocked 并通知人工介入
        """
        task_id = payload.get("task_id")
        current_state = payload.get("state", "")
        raw_stall_count = int(payload.get("stall_count", 0) or 0)
        raw_escalation_level = int(payload.get("escalation_level", 0) or 0)

        task_uuid = None
        try:
            task_uuid = uuid.UUID(str(task_id)) if task_id else None
        except (TypeError, ValueError):
            log.error(f"Invalid task_id in stalled event: {task_id}")
            return
        if task_uuid is None:
            log.error("Missing task_id in stalled event")
            return

        async with async_session() as session:
            svc = TaskService(session)
            task = await svc.get_task(task_uuid)
            meta = dict(task.meta or {})
            recovery = dict(meta.get("recovery") or {})
            stall_count = max(raw_stall_count, int(recovery.get("stall_count", 0) or 0))
            escalation_level = max(raw_escalation_level, int(recovery.get("escalation_level", 0) or 0))
            assignee_org = payload.get("assignee_org") or task.assignee_org or task.org or ""

            log.warning(
                f"⏸️ Task {task_id} stalled! state={current_state} "
                f"stall_count={stall_count} escalation={escalation_level} trace={trace_id}"
            )

            # 策略 1: 重试 — 未超过重试次数时，重新派发同一 agent
            if stall_count < MAX_STALL_RETRIES:
                agent = STATE_AGENT_MAP.get(TaskState(current_state)) if current_state else None
                if current_state in ("Doing", "Next"):
                    agent = ORG_AGENT_MAP.get(assignee_org, agent)

                if agent:
                    now = datetime.now(timezone.utc)
                    recovery.update({
                        "stall_count": stall_count + 1,
                        "escalation_level": escalation_level,
                        "status": "retrying",
                        "last_state": current_state,
                        "last_retry_at": now.isoformat(),
                    })
                    meta["recovery"] = recovery
                    task.meta = meta
                    task.updated_at = now
                    await session.commit()

                    log.info(f"🔄 Retrying task {task_id} → agent '{agent}' (attempt {stall_count + 1})")
                    await self.bus.publish(
                        topic=TOPIC_TASK_DISPATCH,
                        trace_id=trace_id,
                        event_type="task.dispatch.retry",
                        producer="orchestrator",
                        payload={
                            "task_id": task_id,
                            "agent": agent,
                            "state": current_state,
                            "message": f"任务停滞重试 (第{stall_count + 1}次)",
                            "stall_count": stall_count + 1,
                            "escalation_level": escalation_level,
                        },
                    )
                    return

            # 策略 2: 升级 — 重试耗尽，向上级流转
            if escalation_level < MAX_ESCALATION_LEVEL:
                escalate_to = _ESCALATION_PATH.get(current_state)
                if escalate_to:
                    next_level = escalation_level + 1
                    reason = f"任务在 {current_state} 停滞，升级处理"
                    recovery.update({
                        "stall_count": 0,
                        "escalation_level": next_level,
                        "status": "escalated",
                        "last_state": escalate_to.value,
                        "last_escalated_from": current_state,
                        "last_escalated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    meta["recovery"] = recovery
                    task.meta = meta
                    await svc.transition_state(
                        task_id=task_uuid,
                        new_state=escalate_to,
                        agent="orchestrator",
                        reason=reason,
                    )
                    log.info(
                        f"⬆️ Escalating task {task_id}: {current_state} → {escalate_to.value} "
                        f"(level {next_level})"
                    )
                    await self.bus.publish(
                        topic=TOPIC_TASK_ESCALATED,
                        trace_id=trace_id,
                        event_type="task.escalated",
                        producer="orchestrator",
                        payload={
                            "task_id": task_id,
                            "from_state": current_state,
                            "to_state": escalate_to.value,
                            "escalation_level": next_level,
                            "reason": reason,
                            "assignee_org": assignee_org,
                        },
                    )
                    return

            # 策略 3: 所有升级耗尽 → 标记 Blocked，等待人工介入
            reason = f"任务多次停滞（重试{MAX_STALL_RETRIES}次+升级{MAX_ESCALATION_LEVEL}级），需人工介入"
            recovery.update({
                "stall_count": stall_count,
                "escalation_level": escalation_level,
                "status": "blocked",
                "last_state": TaskState.Blocked.value,
                "last_blocked_at": datetime.now(timezone.utc).isoformat(),
            })
            meta["recovery"] = recovery
            task.meta = meta
            task.block = reason
            log.error(
                f"🚨 Task {task_id} exhausted all recovery options! "
                f"Marking as Blocked. Manual intervention required."
            )
            await svc.transition_state(
                task_id=task_uuid,
                new_state=TaskState.Blocked,
                agent="orchestrator",
                reason=reason,
            )

    # ── 停滞任务检测器 ──

    async def _stall_check_loop(self):
        """定时扫描 Doing/Next 状态超时任务，发布 task.stalled 事件。"""
        while self._running:
            try:
                await asyncio.sleep(STALL_CHECK_INTERVAL_SEC)
                await self._check_stalled()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Stall check error: {e}", exc_info=True)
                await asyncio.sleep(STALL_CHECK_INTERVAL_SEC)

    async def _check_stalled(self):
        """扫描数据库中 Doing/Next 状态超过阈值未更新的任务。"""
        threshold = datetime.now(timezone.utc) - timedelta(seconds=STALL_THRESHOLD_SEC)

        async with async_session() as session:
            svc = TaskService(session)
            # 查找超时任务：state in (Doing, Next) 且 updated_at < threshold
            from sqlalchemy import select
            from ..models.task import Task
            stmt = select(Task).where(
                Task.state.in_([TaskState.Doing, TaskState.Next]),
                Task.updated_at < threshold,
                Task.archived == False,  # noqa: E712
            )
            result = await session.execute(stmt)
            stalled_tasks = result.scalars().all()

        for task in stalled_tasks:
            task_id = str(task.task_id)
            state = task.state.value if isinstance(task.state, TaskState) else str(task.state)
            recovery = dict((task.meta or {}).get("recovery") or {})
            log.warning(
                f"⏰ Detected stalled task {task_id} in state={state}, "
                f"last updated {task.updated_at}"
            )
            await self.bus.publish(
                topic=TOPIC_TASK_STALLED,
                trace_id=task.trace_id or str(uuid.uuid4()),
                event_type="task.stalled.detected",
                producer="orchestrator.stall_checker",
                payload={
                    "task_id": task_id,
                    "state": state,
                    "assignee_org": task.assignee_org or task.org or "",
                    "stall_count": int(recovery.get("stall_count", 0) or 0),
                    "escalation_level": int(recovery.get("escalation_level", 0) or 0),
                    "last_updated": task.updated_at.isoformat() if task.updated_at else "",
                },
            )


async def run_orchestrator():
    """入口函数 — 用于直接运行 worker。"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    worker = OrchestratorWorker()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(worker.stop()))

    await worker.start()


if __name__ == "__main__":
    asyncio.run(run_orchestrator())
