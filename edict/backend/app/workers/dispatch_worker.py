"""Agent 派发执行器。

核心解决旧架构痛点：
- 旧: daemon 线程 + subprocess.run → kill -9 丢失一切
- 新: Redis Streams ACK 保证 → 崩溃后自动重新投递

流程:
1. 从 task.dispatch stream 消费事件
2. 组装富上下文并注入 SOUL、记忆和技能
3. 调用 OpenClaw CLI: `openclaw agent --agent xxx -m "..."`
4. 解析 agent 输出与异常分类
5. ACK 事件或交由重投递 / 死信链路处理
"""

import asyncio
import json
import logging
import os
import pathlib
import re
import signal
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone

from ..config import get_settings
from ..db import async_session
from ..models.task import Task
from ..services.event_bus import (
    EventBus,
    TOPIC_TASK_DISPATCH,
    TOPIC_TASK_STALLED,
    TOPIC_TASK_STATUS,
    TOPIC_AGENT_THOUGHTS,
    TOPIC_AGENT_HEARTBEAT,
)

log = logging.getLogger("edict.dispatcher")

GROUP = "dispatcher"
CONSUMER = "disp-1"


class DispatchError(Exception):
    """带分类的派发错误。"""

    def __init__(self, msg: str, retryable: bool = True):
        super().__init__(msg)
        self.retryable = retryable

# Agent 分组映射 — 用于加载 group 级 prompt
_GROUP_MAP = {
    "control_center": "sansheng",
    "plan_center": "sansheng",
    "review_center": "sansheng",
    "dispatch_center": "sansheng",
    "data_specialist": "liubu",
    "docs_specialist": "liubu",
    "code_specialist": "liubu",
    "audit_specialist": "liubu",
    "deploy_specialist": "liubu",
    "admin_specialist": "liubu",
    "search_specialist": None,
}


def _resolve_agents_dir() -> pathlib.Path:
    """定位 agents/ 目录。"""
    settings = get_settings()
    if settings.openclaw_project_dir:
        return pathlib.Path(settings.openclaw_project_dir) / "agents"
    # 默认: 相对于 edict/backend 上溯到项目根
    return pathlib.Path(__file__).resolve().parents[4] / "agents"


def _build_soul_context(agent_id: str) -> str:
    """拼装三层 prompt 层级：GLOBAL.md → group/*.md → {agent}/SOUL.md。"""
    agents_dir = _resolve_agents_dir()
    parts = []

    global_md = agents_dir / "GLOBAL.md"
    if global_md.exists():
        parts.append(global_md.read_text(encoding="utf-8"))

    group = _GROUP_MAP.get(agent_id)
    if group:
        group_md = agents_dir / "groups" / f"{group}.md"
        if group_md.exists():
            parts.append(group_md.read_text(encoding="utf-8"))

    soul_md = agents_dir / agent_id / "SOUL.md"
    if soul_md.exists():
        parts.append(soul_md.read_text(encoding="utf-8"))

    return "\n---\n".join(parts) if parts else ""


def _build_task_context(payload: dict) -> str:
    """从 dispatch 事件 payload 中提取结构化任务上下文。"""
    sections = []

    task_id = payload.get("task_id", "")
    title = payload.get("title", "")
    description = payload.get("description", "")
    state = payload.get("state", "")
    org = payload.get("org", "")
    priority = payload.get("priority", "中")
    tags = payload.get("tags", [])

    sections.append(f"## 当前任务\n- ID: {task_id}\n- 标题: {title}\n- 状态: {state}\n- 部门: {org}\n- 优先级: {priority}")
    if tags:
        sections.append(f"- 标签: {', '.join(tags)}")
    if description:
        sections.append(f"\n### 任务描述\n{description}")

    # Todos
    todos = payload.get("todos", [])
    if todos:
        todo_lines = []
        for t in todos:
            status_icon = {"completed": "✅", "in-progress": "🔄"}.get(t.get("status", ""), "⬜")
            todo_lines.append(f"  {status_icon} {t.get('title', '')}")
        sections.append(f"\n### 子任务\n" + "\n".join(todo_lines))

    # 最近流转记录 (最多 5 条)
    flow_log = payload.get("flow_log", [])
    if flow_log:
        recent = flow_log[-5:]
        flow_lines = [f"  - [{e.get('at', '')}] {e.get('from', '')} → {e.get('to', '')}: {e.get('remark', '')}" for e in recent]
        sections.append(f"\n### 最近流转\n" + "\n".join(flow_lines))

    # 最近进展 (最多 3 条)
    progress_log = payload.get("progress_log", [])
    if progress_log:
        recent = progress_log[-3:]
        prog_lines = [f"  - [{e.get('at', '')}] {e.get('agentLabel', e.get('agent', ''))}: {e.get('text', '')}" for e in recent]
        sections.append(f"\n### 最近进展\n" + "\n".join(prog_lines))

    # 阻塞信息
    block = payload.get("block", "")
    if block and block != "无":
        sections.append(f"\n### ⚠️ 阻塞\n{block}")

    return "\n".join(sections)


def _build_reminder(agent_id: str, payload: dict) -> str:
    """在 prompt 尾部注入动态提醒（借鉴 Claude 的 reminderInstructions）。"""
    reminders = []

    state = payload.get("state", "")
    if state == "Doing":
        reminders.append("先创建 todo 分解任务，再开始执行。每完成一步立即用 progress 上报。")
    elif state == "Review":
        reminders.append("这是复审任务。审核完毕后用 state 命令流转状态，附带审核意见。")
    elif state == "ReviewCenter":
        reminders.append("评审中心复核：通过则流转 Assigned，不通过则退回 PlanCenter 并说明原因。")

    # 如果有未完成的 todos，提醒继续
    todos = payload.get("todos", [])
    in_progress = [t for t in todos if t.get("status") == "in-progress"]
    not_started = [t for t in todos if t.get("status") == "not-started"]
    if in_progress:
        reminders.append(f"有 {len(in_progress)} 个进行中的子任务，优先完成它们。")
    elif not_started:
        reminders.append(f"有 {len(not_started)} 个待开始的子任务。")

    # 阻塞提醒
    block = payload.get("block", "")
    if block and block != "无":
        reminders.append(f"⚠️ 存在阻塞: {block}。如已解除，先更新状态再继续。")

    if not reminders:
        return ""
    return "\n\n## ⚡ Reminder\n" + "\n".join(f"- {r}" for r in reminders)


def _resolve_project_root() -> pathlib.Path:
    """定位项目根目录。"""
    settings = get_settings()
    if settings.openclaw_project_dir:
        return pathlib.Path(settings.openclaw_project_dir)
    return pathlib.Path(__file__).resolve().parents[4]


def _build_memory_context(agent_id: str, task_id: str, payload: dict) -> str:
    """分层注入三级记忆：全局规则 → Agent 经验 → 任务上下文。"""
    root = _resolve_project_root()
    parts = []

    # 1. 全局共享记忆 — 始终注入
    shared_file = root / "data" / "shared_memory.json"
    if shared_file.exists():
        try:
            shared = json.loads(shared_file.read_text(encoding="utf-8"))
            rules = shared.get("rules", [])
            if rules:
                rule_lines = [r.get("content", "") for r in rules[-20:]]
                parts.append("## 全局规则\n" + "\n".join(f"- {r}" for r in rule_lines if r))
        except (json.JSONDecodeError, OSError):
            pass

    # 2. Agent 永久记忆 — 按相关性过滤，最多 50 条
    agent_mem_file = root / "data" / "agent_memory" / f"{agent_id}.json"
    if agent_mem_file.exists():
        try:
            agent_data = json.loads(agent_mem_file.read_text(encoding="utf-8"))
            memories = agent_data.get("memories", [])
            if memories:
                # 相关性排序：pinned 优先，其次按 tags 交集匹配当前任务
                task_tags = set(payload.get("tags", []))
                task_org = payload.get("org", "")
                if task_org:
                    task_tags.add(task_org)

                def _relevance(m):
                    pinned = 1 if m.get("pinned") else 0
                    overlap = len(task_tags & set(m.get("relevance_tags", [])))
                    is_feedback = 1 if m.get("type") == "feedback" else 0
                    return (pinned, overlap, is_feedback)

                memories.sort(key=_relevance, reverse=True)
                top = memories[:50]
                mem_lines = [f"- [{m.get('type', '')}] {m.get('content', '')}" for m in top]
                parts.append("## 历史经验\n" + "\n".join(mem_lines))
        except (json.JSONDecodeError, OSError):
            pass

    # 3. 任务上下文记忆 — 完整注入上游 Agent 决策链
    task_mem_file = root / "data" / "task_memory" / f"{task_id}.json"
    if task_mem_file.exists():
        try:
            task_data = json.loads(task_mem_file.read_text(encoding="utf-8"))
            chain = task_data.get("context_chain", [])
            if chain:
                chain_lines = []
                for c in chain:
                    decisions = ", ".join(c.get("key_decisions", []))
                    warnings = ", ".join(c.get("warnings", []))
                    line = f"- [{c.get('phase', '')}] {c.get('agent', '')}: {decisions}"
                    if warnings:
                        line += f" ⚠️ {warnings}"
                    chain_lines.append(line)
                parts.append("## 上游决策链\n" + "\n".join(chain_lines))
        except (json.JSONDecodeError, OSError):
            pass

    if not parts:
        return ""
    return "\n---\n".join(parts)


def _safe_head_tail(text: str, keep_chars: int) -> str:
    """在保持首尾语义的前提下压缩长文本。"""
    if not text or keep_chars <= 0 or len(text) <= keep_chars:
        return text
    if keep_chars < 160:
        return text[:keep_chars]
    head = int(keep_chars * 0.65)
    tail = max(keep_chars - head - 32, 48)
    return f"{text[:head]}\n\n[...上下文已折叠，详见归档摘要...]\n\n{text[-tail:]}"



def _resolve_context_archive_dir() -> pathlib.Path:
    settings = get_settings()
    root = _resolve_project_root()
    archive_dir = pathlib.Path(settings.context_window_archive_dir)
    if not archive_dir.is_absolute():
        archive_dir = (root / archive_dir).resolve()
    archive_dir.mkdir(parents=True, exist_ok=True)
    return archive_dir



def _build_context_window_package(
    agent: str,
    task_id: str,
    payload: dict,
    message: str,
    soul_context: str,
    task_context: str,
    memory_context: str,
    skills_context: str,
    reminder: str,
) -> tuple[str, dict]:
    """统一处理上下文窗口预警、压缩归档与续写衔接。"""
    settings = get_settings()
    meta = payload.setdefault("meta", {})

    if not settings.context_window_enabled:
        base_message = message
        for part in (soul_context, task_context, memory_context, skills_context):
            if part:
                base_message = f"{base_message}\n\n---\n{part}"
        if reminder:
            base_message = f"{base_message}\n{reminder}"
        state = {
            "enabled": False,
            "status": "disabled",
            "current_chars": len(base_message),
            "soft_limit_chars": settings.context_window_soft_limit_chars,
            "hard_limit_chars": settings.context_window_hard_limit_chars,
        }
        meta["context_window"] = state
        return base_message, state

    sections = {
        "message": message or "",
        "soul_context": soul_context or "",
        "task_context": task_context or "",
        "memory_context": memory_context or "",
        "skills_context": skills_context or "",
        "reminder": reminder or "",
    }
    section_lengths = {name: len(text) for name, text in sections.items() if text}
    raw_total = sum(section_lengths.values())
    hard_limit = max(settings.context_window_hard_limit_chars, 1024)
    soft_limit = min(settings.context_window_soft_limit_chars, hard_limit)
    warning_ratio = max(0.1, min(settings.context_window_warning_ratio, 1.0))
    critical_ratio = max(warning_ratio, min(settings.context_window_critical_ratio, 1.0))
    warning_threshold = int(hard_limit * warning_ratio)
    critical_threshold = int(hard_limit * critical_ratio)

    status = "normal"
    if raw_total >= hard_limit:
        status = "overflow"
    elif raw_total >= critical_threshold:
        status = "critical"
    elif raw_total >= warning_threshold or raw_total >= soft_limit:
        status = "warning"

    flow_log = list(payload.get("flow_log", []))
    progress_log = list(payload.get("progress_log", []))
    archived_items = {
        "flow_log": max(0, len(flow_log) - settings.context_window_include_flow_limit),
        "progress_log": max(0, len(progress_log) - settings.context_window_include_progress_limit),
    }
    trimmed_payload = dict(payload)
    trimmed_payload["flow_log"] = flow_log[-settings.context_window_include_flow_limit :]
    trimmed_payload["progress_log"] = progress_log[-settings.context_window_include_progress_limit :]
    payload.update(trimmed_payload)

    archive_path = None
    compressed = False
    continuation_hint = ""

    if status in {"warning", "critical", "overflow"}:
        archive_payload = {
            "task_id": task_id,
            "agent": agent,
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "raw_total_chars": raw_total,
            "limits": {
                "soft": soft_limit,
                "hard": hard_limit,
                "warning_threshold": warning_threshold,
                "critical_threshold": critical_threshold,
            },
            "sections": sections,
            "trimmed_context": {
                "flow_log": flow_log[:-settings.context_window_include_flow_limit] if len(flow_log) > settings.context_window_include_flow_limit else [],
                "progress_log": progress_log[:-settings.context_window_include_progress_limit] if len(progress_log) > settings.context_window_include_progress_limit else [],
            },
        }
        try:
            archive_dir = _resolve_context_archive_dir()
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            archive_path = archive_dir / f"{task_id}_{agent}_{stamp}.json"
            archive_path.write_text(
                json.dumps(archive_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            log.warning(f"Failed to archive context window snapshot for {task_id}: {exc}")
            archive_path = None

    if raw_total > hard_limit:
        compressed = True
        budget = max(settings.context_window_archive_keep_chars, int(hard_limit * 0.82))
        kept_message = sections["message"]
        preserved = len(kept_message) + len(sections["reminder"])
        remaining = max(budget - preserved, 1600)
        soul_budget = max(int(remaining * 0.3), 600)
        task_budget = max(int(remaining * 0.25), 500)
        memory_budget = max(int(remaining * 0.3), 500)
        skills_budget = max(remaining - soul_budget - task_budget - memory_budget, 300)
        sections["soul_context"] = _safe_head_tail(sections["soul_context"], soul_budget)
        sections["task_context"] = _safe_head_tail(sections["task_context"], task_budget)
        sections["memory_context"] = _safe_head_tail(sections["memory_context"], memory_budget)
        sections["skills_context"] = _safe_head_tail(sections["skills_context"], skills_budget)

    if settings.context_window_enable_continuation_hint and status in {"warning", "critical", "overflow"}:
        archive_text = str(archive_path) if archive_path else "未写入归档文件"
        continuation_hint = (
            "\n\n## 上下文窗口提示\n"
            f"- 当前上下文长度约 {raw_total} 字符，已达到 {status} 阈值。\n"
            f"- 系统已保留最近 {settings.context_window_include_flow_limit} 条流转和最近 {settings.context_window_include_progress_limit} 条进展。\n"
            f"- 历史上下文归档: {archive_text}\n"
            "- 若本轮输出仍不足，请下一轮优先基于归档摘要续写，避免重复展开全部历史。"
        )

    final_message = sections["message"]
    for key in ("soul_context", "task_context", "memory_context", "skills_context"):
        if sections[key]:
            final_message = f"{final_message}\n\n---\n{sections[key]}"
    if sections["reminder"]:
        final_message = f"{final_message}\n{sections['reminder']}"
    if continuation_hint:
        final_message = f"{final_message}{continuation_hint}"

    state = {
        "enabled": True,
        "status": status,
        "compressed": compressed,
        "current_chars": len(final_message),
        "raw_chars": raw_total,
        "soft_limit_chars": soft_limit,
        "hard_limit_chars": hard_limit,
        "warning_threshold_chars": warning_threshold,
        "critical_threshold_chars": critical_threshold,
        "archived_flow_items": archived_items["flow_log"],
        "archived_progress_items": archived_items["progress_log"],
        "archive_path": str(archive_path) if archive_path else "",
        "continuation_hint": bool(continuation_hint),
        "sections": section_lengths,
    }
    meta["context_window"] = state
    return final_message, state


# ── Prompt 注入检测 ──

_INJECTION_PATTERNS = [
    re.compile(r"忽略.{0,20}(指令|规则|协议)", re.IGNORECASE),
    re.compile(r"ignore.{0,20}(instructions|rules|above)", re.IGNORECASE),
    re.compile(r"system\s*:\s*", re.IGNORECASE),
    re.compile(r"<\s*system\s*>", re.IGNORECASE),
    re.compile(r"你(现在)?是.{0,10}(管理员|超级用户)", re.IGNORECASE),
    re.compile(r"override|bypass|skip.{0,10}(check|review|approval)", re.IGNORECASE),
]


def _sanitize_agent_output(output: str, agent_id: str) -> tuple[str, list[str]]:
    """检测 Agent 输出中的注入模式。返回 (原始文本, 告警列表)。"""
    warnings = []
    for pattern in _INJECTION_PATTERNS:
        match = pattern.search(output)
        if match:
            warnings.append(
                f"Agent {agent_id} 输出触发注入检测: '{match.group()}' (pattern: {pattern.pattern})"
            )
    return output, warnings


def _load_agent_skills(agent_id: str, payload: dict) -> str:
    """按任务特征动态加载 Agent Skills（延迟能力加载）。"""
    agents_dir = _resolve_agents_dir()
    manifest_path = agents_dir / agent_id / "skills" / "manifest.json"
    if not manifest_path.exists():
        return ""

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return ""

    task_tags = set(payload.get("tags", []))
    task_org = payload.get("org", "")

    matched_skills = []
    for skill in manifest.get("skills", []):
        tag_match = task_tags & set(skill.get("match_tags", []))
        org_match = task_org in skill.get("match_orgs", [])
        if tag_match or org_match:
            skill_path = agents_dir / agent_id / "skills" / skill["file"]
            if skill_path.exists():
                try:
                    matched_skills.append(skill_path.read_text(encoding="utf-8"))
                except OSError:
                    pass

    if matched_skills:
        return "## 本次任务相关技能\n" + "\n---\n".join(matched_skills)
    return ""


async def _persist_context_window_state(task_id: str, context_window: dict) -> None:
    """把上下文窗口状态持久化到任务元数据，供实时看板与详情页读取。"""
    if not task_id or not context_window:
        return
    try:
        task_uuid = uuid.UUID(str(task_id))
    except (ValueError, TypeError):
        return

    try:
        async with async_session() as session:
            task = await session.get(Task, task_uuid)
            if not task:
                return
            meta = dict(task.meta or {})
            meta["context_window"] = context_window
            task.meta = meta
            task.updated_at = datetime.now(timezone.utc)
            await session.commit()
    except Exception as exc:
        log.warning(f"Failed to persist context window for {task_id}: {exc}")


async def _hydrate_dispatch_payload(task_id: str, payload: dict | None) -> dict:
    """用数据库中的任务快照补全派发 payload，避免事件载荷过薄导致上下文丢失。"""
    merged = {}
    if payload:
        merged.update(payload)

    if not task_id:
        return merged

    try:
        task_uuid = uuid.UUID(str(task_id))
    except (ValueError, TypeError):
        return merged

    try:
        async with async_session() as session:
            task = await session.get(Task, task_uuid)
            if not task:
                return merged
            snapshot = task.to_dict()
    except Exception as exc:
        log.warning(f"Failed to hydrate dispatch payload for {task_id}: {exc}")
        return merged

    hydrated = dict(snapshot)
    for key, value in merged.items():
        if value is None:
            continue
        if isinstance(value, str) and value == "":
            continue
        if isinstance(value, (list, dict)) and not value:
            continue
        hydrated[key] = value

    hydrated["task_id"] = str(task_id)
    hydrated["meta"] = {
        **dict(snapshot.get("meta") or {}),
        **dict(merged.get("meta") or {}),
    }
    hydrated["context_window"] = hydrated["meta"].get(
        "context_window",
        merged.get("context_window") or snapshot.get("context_window") or {},
    )
    if not hydrated.get("org"):
        hydrated["org"] = snapshot.get("org") or hydrated.get("assignee_org") or ""
    if not hydrated.get("assignee_org"):
        hydrated["assignee_org"] = snapshot.get("assignee_org") or ""
    return hydrated


async def _record_agent_heartbeat(
    task_id: str,
    agent: str,
    trace_id: str,
    status: str,
) -> None:
    """把派发心跳写入任务元数据并刷新 updated_at，避免长任务被误判停滞。"""
    if not task_id:
        return

    try:
        task_uuid = uuid.UUID(str(task_id))
    except (ValueError, TypeError):
        return

    try:
        async with async_session() as session:
            task = await session.get(Task, task_uuid)
            if not task:
                return
            meta = dict(task.meta or {})
            heartbeat = dict(meta.get("heartbeat") or {})
            now = datetime.now(timezone.utc)
            heartbeat.update({
                "agent": agent,
                "trace_id": trace_id,
                "status": status,
                "at": now.isoformat(),
            })
            meta["heartbeat"] = heartbeat
            task.meta = meta
            task.updated_at = now
            await session.commit()
    except Exception as exc:
        log.warning(f"Failed to record heartbeat for {task_id}/{agent}: {exc}")


class DispatchWorker:
    """Agent 派发 Worker — 快慢 Agent 分桶并发控制。"""

    # 快/慢 Agent 分桶 — 中心优先快响应，专家独立限流
    _BUCKET_CONFIG = {
        "fast": {"agents": {"control_center", "plan_center", "review_center", "dispatch_center"}, "limit": 4},
        "slow": {"agents": {"data_specialist", "docs_specialist", "code_specialist", "audit_specialist", "deploy_specialist", "admin_specialist", "search_specialist"}, "limit": 3},
    }

    def __init__(self):
        self.bus = EventBus()
        self._running = False
        self._buckets: dict[str, asyncio.Semaphore] = {
            name: asyncio.Semaphore(cfg["limit"])
            for name, cfg in self._BUCKET_CONFIG.items()
        }
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._inflight: set[str] = set()
        # 执行时间记录（仅用于监控告警）
        self._durations: dict[str, list[float]] = {}

    def _get_bucket(self, agent_id: str) -> asyncio.Semaphore:
        """根据 agent 类型返回对应桶的信号量。"""
        for name, cfg in self._BUCKET_CONFIG.items():
            if agent_id in cfg["agents"]:
                return self._buckets[name]
        return self._buckets["slow"]  # 未知 Agent 归入慢桶

    async def start(self):
        await self.bus.connect()
        await self.bus.ensure_consumer_group(TOPIC_TASK_DISPATCH, GROUP)
        self._running = True
        log.info("🚀 Dispatch worker started")

        # 恢复崩溃遗留
        await self._recover_pending()

        while self._running:
            try:
                await self._poll_cycle()
            except Exception as e:
                log.error(f"Dispatch poll error: {e}", exc_info=True)
                await asyncio.sleep(2)

    async def stop(self):
        self._running = False
        # 等待进行中的 agent 调用完成
        if self._active_tasks:
            log.info(f"Waiting for {len(self._active_tasks)} active dispatches...")
            await asyncio.gather(*self._active_tasks.values(), return_exceptions=True)
        await self.bus.close()
        log.info("Dispatch worker stopped")

    async def _recover_pending(self):
        events = await self.bus.claim_stale(
            TOPIC_TASK_DISPATCH, GROUP, CONSUMER, min_idle_ms=60000, count=20
        )
        if events:
            log.info(f"Recovering {len(events)} stale dispatch events")
            for entry_id, event in events:
                await self._dispatch(entry_id, event)

    async def _poll_cycle(self):
        events = await self.bus.consume(
            TOPIC_TASK_DISPATCH, GROUP, CONSUMER, count=3, block_ms=2000
        )
        for entry_id, event in events:
            # 每个派发在独立任务中执行，带并发控制
            task = asyncio.create_task(self._dispatch(entry_id, event))
            task_id = event.get("payload", {}).get("task_id", entry_id)
            self._active_tasks[task_id] = task
            task.add_done_callback(lambda t, tid=task_id: self._active_tasks.pop(tid, None))

    async def _dispatch(self, entry_id: str, event: dict):
        """执行一次 agent 派发（桶级并发控制）。"""
        payload = event.get("payload", {})
        task_id = payload.get("task_id", "")
        payload = await _hydrate_dispatch_payload(task_id, payload)
        task_id = payload.get("task_id", task_id)
        agent = payload.get("agent", "")
        message = payload.get("message", "")
        trace_id = event.get("trace_id", "")
        state = payload.get("state", "")
        heartbeat_task: asyncio.Task | None = None

        # 去重：同一任务如果已在派发中，跳过并 ACK
        if task_id in self._inflight:
            log.warning(f"⚡ Skipping duplicate dispatch for task {task_id} (already in-flight)")
            await self.bus.ack(TOPIC_TASK_DISPATCH, GROUP, entry_id)
            return
        self._inflight.add(task_id)

        sem = self._get_bucket(agent)
        async with sem:

            log.info(f"🔄 Dispatching task {task_id} → agent '{agent}' state={state}")

            # 组装富上下文
            soul_context = _build_soul_context(agent)
            task_context = _build_task_context(payload)
            reminder = _build_reminder(agent, payload)
            memory_context = _build_memory_context(agent, task_id, payload)
            skills_context = _load_agent_skills(agent, payload)
            enriched_message, context_window = _build_context_window_package(
                agent=agent,
                task_id=task_id,
                payload=payload,
                message=message,
                soul_context=soul_context,
                task_context=task_context,
                memory_context=memory_context,
                skills_context=skills_context,
                reminder=reminder,
            )

            await _persist_context_window_state(task_id, context_window)

            if context_window.get("status") in {"warning", "critical", "overflow"}:
                log.info(
                    "📦 Context window managed for task %s agent %s: status=%s raw=%s final=%s",
                    task_id,
                    agent,
                    context_window.get("status"),
                    context_window.get("raw_chars"),
                    context_window.get("current_chars"),
                )

            # 发布心跳
            await self.bus.publish(
                topic=TOPIC_AGENT_HEARTBEAT,
                trace_id=trace_id,
                event_type="agent.dispatch.start",
                producer="dispatcher",
                payload={"task_id": task_id, "agent": agent, "status": "running"},
            )
            await _record_agent_heartbeat(task_id, agent, trace_id, status="running")
            heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(task_id, agent, trace_id)
            )

            try:
                start_time = time.monotonic()
                result = await self._call_openclaw(
                    agent,
                    enriched_message,
                    task_id,
                    trace_id,
                    payload,
                    soul_context,
                )
                elapsed = time.monotonic() - start_time

                # 记录执行时间（仅用于监控和告警）
                self._durations.setdefault(agent, []).append(elapsed)
                if len(self._durations[agent]) > 20:
                    self._durations[agent] = self._durations[agent][-20:]
                avg = sum(self._durations[agent]) / len(self._durations[agent])
                if elapsed > 2 * avg and elapsed > 120:
                    log.warning(f"⚠️ Agent {agent} slowdown: {elapsed:.0f}s (avg: {avg:.0f}s)")

                # Prompt 注入检测
                stdout = result.get("stdout", "")
                stdout, injection_warnings = _sanitize_agent_output(stdout, agent)
                if injection_warnings:
                    for w in injection_warnings:
                        log.warning(f"🛡️ {w}")
                    # 发布注入告警事件
                    await self.bus.publish(
                        topic=TOPIC_TASK_STALLED,
                        trace_id=trace_id,
                        event_type="agent.injection.detected",
                        producer="dispatcher",
                        payload={
                            "task_id": task_id,
                            "agent": agent,
                            "warnings": injection_warnings,
                        },
                    )

                # 发布 agent 输出
                await self.bus.publish(
                    topic=TOPIC_AGENT_THOUGHTS,
                    trace_id=trace_id,
                    event_type="agent.output",
                    producer=f"agent.{agent}",
                    payload={
                        "task_id": task_id,
                        "agent": agent,
                        "output": stdout,
                        "return_code": result.get("returncode", -1),
                        "injection_warnings": injection_warnings or None,
                    },
                )

                if result.get("returncode") == 0:
                    await self.bus.publish(
                        topic=TOPIC_AGENT_HEARTBEAT,
                        trace_id=trace_id,
                        event_type="agent.dispatch.complete",
                        producer="dispatcher",
                        payload={"task_id": task_id, "agent": agent, "status": "completed"},
                    )
                    await _record_agent_heartbeat(task_id, agent, trace_id, status="completed")
                    log.info(f"✅ Agent '{agent}' completed task {task_id}")
                    await self.bus.ack(TOPIC_TASK_DISPATCH, GROUP, entry_id)
                    return

                # 失败分类
                stderr = result.get("stderr", "")
                if "TIMEOUT" in stderr:
                    raise DispatchError("Agent timeout", retryable=True)
                elif "command not found" in stderr:
                    raise DispatchError("openclaw binary missing", retryable=False)
                elif result["returncode"] in (1, 2):
                    raise DispatchError(
                        f"Agent failed: rc={result['returncode']}", retryable=True
                    )
                else:
                    raise DispatchError(
                        f"Unknown error: rc={result['returncode']}", retryable=False
                    )

            except DispatchError as e:
                delivery_count = await self.bus.get_delivery_count(
                    TOPIC_TASK_DISPATCH, GROUP, entry_id
                )

                if e.retryable and delivery_count < 3:
                    log.warning(
                        f"🔄 Retryable failure for {task_id}, attempt {delivery_count + 1}/3: {e}"
                    )
                    return  # 不 ACK → Redis 自动重投递

                # 不可重试 or 重试耗尽 → ACK + 发布失败事件 + DLQ
                log.error(
                    f"💀 Dispatch dead-lettered: {task_id} → {agent} "
                    f"(retryable={e.retryable}, attempts={delivery_count + 1}): {e}"
                )
                await self.bus.publish(
                    topic=TOPIC_TASK_STALLED,
                    trace_id=trace_id,
                    event_type="task.dispatch.failed",
                    producer="dispatcher",
                    payload={
                        "task_id": task_id,
                        "agent": agent,
                        "error": str(e),
                        "retryable": e.retryable,
                        "attempts": delivery_count + 1,
                    },
                )
                await self.bus.publish(
                    topic=TOPIC_AGENT_HEARTBEAT,
                    trace_id=trace_id,
                    event_type="agent.dispatch.failed",
                    producer="dispatcher",
                    payload={"task_id": task_id, "agent": agent, "status": "failed"},
                )
                await _record_agent_heartbeat(task_id, agent, trace_id, status="failed")
                await self.bus.publish(
                    topic="dead_letter",
                    trace_id=trace_id,
                    event_type="task.dispatch.dead_letter",
                    producer="dispatcher",
                    payload={
                        "task_id": task_id,
                        "agent": agent,
                        "error": str(e),
                    },
                )
                await self.bus.ack(TOPIC_TASK_DISPATCH, GROUP, entry_id)

            except Exception as e:
                log.error(f"❌ Dispatch failed: task {task_id} → {agent}: {e}", exc_info=True)
                await self.bus.publish(
                    topic=TOPIC_AGENT_HEARTBEAT,
                    trace_id=trace_id,
                    event_type="agent.dispatch.error",
                    producer="dispatcher",
                    payload={"task_id": task_id, "agent": agent, "status": "error"},
                )
                await _record_agent_heartbeat(task_id, agent, trace_id, status="error")
                # 不 ACK → Redis 会重新投递给其他消费者
            finally:
                if heartbeat_task:
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass
                self._inflight.discard(task_id)

    async def _heartbeat_loop(self, task_id: str, agent: str, trace_id: str):
        """长任务执行期间周期性刷新心跳，避免被停滞检测误杀。"""
        while True:
            await asyncio.sleep(60)
            await self.bus.publish(
                topic=TOPIC_AGENT_HEARTBEAT,
                trace_id=trace_id,
                event_type="agent.dispatch.pulse",
                producer="dispatcher",
                payload={"task_id": task_id, "agent": agent, "status": "running"},
            )
            await _record_agent_heartbeat(task_id, agent, trace_id, status="running")

    async def _call_openclaw(
        self,
        agent: str,
        message: str,
        task_id: str,
        trace_id: str,
        payload: dict | None = None,
        soul_context: str = "",
    ) -> dict:
        """异步调用 OpenClaw CLI — 在线程池中执行，带富上下文注入。"""
        settings = get_settings()
        cmd = [
            settings.openclaw_bin,
            "agent",
            "--agent", agent,
            "-m", message,
        ]

        env = os.environ.copy()
        env["EDICT_TASK_ID"] = task_id
        env["EDICT_TRACE_ID"] = trace_id
        env["EDICT_API_URL"] = f"http://localhost:{settings.port}"

        # 注入额外上下文环境变量
        if payload:
            env["EDICT_TASK_TITLE"] = payload.get("title", "")
            env["EDICT_TASK_STATE"] = payload.get("state", "")
            env["EDICT_TASK_ORG"] = payload.get("org", "")
            env["EDICT_TASK_PRIORITY"] = payload.get("priority", "中")
            tags = payload.get("tags", [])
            if tags:
                env["EDICT_TASK_TAGS"] = ",".join(str(t) for t in tags)

        # 写入临时上下文文件（大型上下文通过文件传递，避免命令行参数过长）
        context_file = None
        if payload:
            context_data = {
                "task_id": task_id,
                "trace_id": trace_id,
                "title": payload.get("title", ""),
                "description": payload.get("description", ""),
                "state": payload.get("state", ""),
                "org": payload.get("org", ""),
                "priority": payload.get("priority", "中"),
                "tags": payload.get("tags", []),
                "todos": payload.get("todos", []),
                "flow_log": payload.get("flow_log", [])[-10:],
                "progress_log": payload.get("progress_log", [])[-5:],
                "block": payload.get("block", ""),
                "meta": payload.get("meta", {}),
                "context_window": payload.get("meta", {}).get("context_window", {}),
                "soul_context": soul_context,
            }
            try:
                fd, context_file = tempfile.mkstemp(suffix=".json", prefix=f"edict_ctx_{task_id}_")
                with os.fdopen(fd, "w") as f:
                    json.dump(context_data, f, ensure_ascii=False, indent=2)
                env["EDICT_CONTEXT_FILE"] = context_file
            except Exception as e:
                log.warning(f"Failed to write context file for {task_id}: {e}")

        log.debug(f"Executing: {' '.join(cmd)}")

        def _run():
            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    env=env,
                    cwd=settings.openclaw_project_dir or None,
                )
                return {
                    "returncode": proc.returncode,
                    "stdout": proc.stdout[-5000:] if proc.stdout else "",
                    "stderr": proc.stderr[-2000:] if proc.stderr else "",
                }
            except subprocess.TimeoutExpired:
                return {"returncode": -1, "stdout": "", "stderr": "TIMEOUT after 300s"}
            except FileNotFoundError:
                return {"returncode": -1, "stdout": "", "stderr": "openclaw command not found"}
            finally:
                # 清理临时上下文文件
                if context_file:
                    try:
                        os.unlink(context_file)
                    except OSError:
                        pass

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)


async def run_dispatcher():
    """入口函数 — 用于直接运行 worker。"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    worker = DispatchWorker()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(worker.stop()))

    await worker.start()


if __name__ == "__main__":
    asyncio.run(run_dispatcher())
