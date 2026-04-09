from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import get_settings

PROJECT_ROOT = Path(__file__).resolve().parents[4]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _resolve_root(path_str: str) -> Path:
    root = Path(path_str).expanduser()
    if not root.is_absolute():
        root = (PROJECT_ROOT / root).resolve()
    return root


def get_hot_workspace_root() -> Path:
    settings = get_settings()
    root = _resolve_root(settings.task_workspace_hot_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_cold_workspace_root() -> Path:
    settings = get_settings()
    root = _resolve_root(settings.task_workspace_cold_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


TASK_WORKSPACE_ROOT = get_hot_workspace_root()
TASK_WORKSPACE_INDEX_DIR = TASK_WORKSPACE_ROOT / "_index"
DEFAULT_COLD_ARCHIVE_ROOT = get_cold_workspace_root()
COLD_ARCHIVE_ROOT = DEFAULT_COLD_ARCHIVE_ROOT


def _safe_slug(text: str, limit: int = 48) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "_", (text or "").strip()).strip("_")
    return (normalized or "task")[:limit]


def _safe_code_prefix(text: str) -> str:
    letters = re.sub(r"[^A-Za-z0-9]", "", (text or "").upper())
    return (letters[:6] or "TASK")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _hash_record(record: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def generate_task_code(existing_codes: list[str] | None = None, creator: str = "TASK") -> str:
    existing_codes = existing_codes or []
    today = datetime.now().strftime("%Y%m%d")
    prefix = _safe_code_prefix(creator)
    pattern = re.compile(rf"^{re.escape(prefix)}-{today}-(\d{{3}})$")
    used_numbers = []
    for code in existing_codes:
        match = pattern.match(str(code))
        if match:
            used_numbers.append(int(match.group(1)))
    next_number = (max(used_numbers) + 1) if used_numbers else 1
    return f"{prefix}-{today}-{next_number:03d}"


def _extract_size_gb(meta: dict[str, Any] | None) -> float:
    meta = meta or {}
    candidates: list[Any] = [
        meta.get("project_size_gb_estimate"),
        meta.get("estimated_size_gb"),
        meta.get("size_gb"),
        meta.get("dataset_size_gb"),
        (meta.get("sourceMeta") or {}).get("project_size_gb_estimate"),
        (meta.get("sourceMeta") or {}).get("estimated_size_gb"),
    ]
    for item in candidates:
        try:
            if item is None or item == "":
                continue
            return float(item)
        except (TypeError, ValueError):
            continue
    return 0.0


def _classify_task_kind(meta: dict[str, Any] | None) -> str:
    meta = meta or {}
    explicit = str(meta.get("task_kind") or meta.get("workspace_task_kind") or "").strip().lower()
    if explicit in {"small", "standard", "huge"}:
        return explicit
    if bool(meta.get("small_task") or meta.get("lightweight_task")):
        return "small"
    if bool(meta.get("huge_project") or meta.get("cold_first")):
        return "huge"
    size_gb = _extract_size_gb(meta)
    threshold = float(get_settings().task_workspace_huge_project_threshold_gb)
    if size_gb >= threshold:
        return "huge"
    return "standard"


def _build_task_policy(task_kind: str, *, size_estimate_gb: float = 0.0) -> dict[str, Any]:
    if task_kind == "small":
        return {
            "mode": "compact",
            "dispatch_strategy": "direct-first",
            "progress_strategy": "summary-first",
            "ledger_strategy": "compact-retention",
            "archive_strategy": "hot-archive",
            "reactivation_strategy": "in-place-preferred",
            "resume_files": [
                "README.md",
                "HANDOFF.md",
                "TODO.md",
                "TASK_RECORD.json",
                "context/latest_context.json",
            ],
            "notes": "轻量任务优先短链路闭环，尽量减少中心间往返，并在完成后保留热盘归档以降低迁移成本。",
        }
    if task_kind == "huge":
        return {
            "mode": "cold-primary",
            "dispatch_strategy": "staged-handoff",
            "progress_strategy": "artifact-first",
            "ledger_strategy": "full-retention",
            "archive_strategy": "cold-archive",
            "reactivation_strategy": "move-to-hot-on-demand",
            "resume_files": [
                "README.md",
                "HANDOFF.md",
                "TODO.md",
                "TASK_RECORD.json",
                "context/latest_context.json",
            ],
            "notes": f"超大任务预计规模约 {size_estimate_gb:.2f} GB，优先冷盘处理，仅保留必要镜像与索引。",
        }
    return {
        "mode": "standard",
        "dispatch_strategy": "center-coordinated",
        "progress_strategy": "full-history",
        "ledger_strategy": "full-retention",
        "archive_strategy": "cold-archive",
        "reactivation_strategy": "move-to-hot-default",
        "resume_files": [
            "README.md",
            "HANDOFF.md",
            "TODO.md",
            "TASK_RECORD.json",
            "context/latest_context.json",
        ],
        "notes": "标准任务按完整任务工作区、账本和冷热归档规则推进。",
    }


def _should_use_cold_primary(meta: dict[str, Any] | None) -> bool:
    meta = meta or {}
    if bool(meta.get("force_cold_storage") or meta.get("cold_first")):
        return True
    if str(meta.get("storage_tier") or "").strip().lower() == "cold-primary":
        return True
    return _classify_task_kind(meta) == "huge"


def workspace_paths(task_code: str, title: str, *, base_root: Path | None = None) -> dict[str, str]:
    slug = _safe_slug(title)
    base_root = base_root or get_hot_workspace_root()
    workspace_dir = base_root / f"{task_code}__{slug}"
    return {
        "root": str(workspace_dir),
        "readme": str(workspace_dir / "README.md"),
        "todo": str(workspace_dir / "TODO.md"),
        "taskrecord": str(workspace_dir / "TASK_RECORD.json"),
        "handoff": str(workspace_dir / "HANDOFF.md"),
        "links": str(workspace_dir / "LINKS.md"),
        "status": str(workspace_dir / "STATUS.json"),
        "context_dir": str(workspace_dir / "context"),
        "context_latest": str(workspace_dir / "context" / "latest_context.json"),
        "continuation_hint": str(workspace_dir / "context" / "continuation_hint.md"),
        "snapshots_dir": str(workspace_dir / "context" / "snapshots"),
        "ledger_dir": str(workspace_dir / "ledger"),
        "artifacts_dir": str(workspace_dir / "artifacts"),
        "agent_notes_dir": str(workspace_dir / "agent_notes"),
        "exports_dir": str(workspace_dir / "exports"),
        "resume_export": str(workspace_dir / "exports" / "summary_for_resume.md"),
    }


def _metadata_mirror_root() -> Path:
    root = get_hot_workspace_root() / "_meta"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _logical_paths_for_workspace(workspace: dict[str, Any], task_code: str, title: str) -> dict[str, str]:
    logical_root = str(workspace.get("path") or "").strip()
    if logical_root:
        return workspace_paths(task_code, title, base_root=Path(logical_root).parent)
    return workspace_paths(task_code, title, base_root=get_hot_workspace_root())


def _actual_paths_for_workspace(workspace: dict[str, Any], task_code: str, title: str) -> dict[str, str]:
    actual_root = str(workspace.get("actual_workspace_path") or workspace.get("path") or "").strip()
    if actual_root:
        return workspace_paths(task_code, title, base_root=Path(actual_root).parent)
    return workspace_paths(task_code, title, base_root=get_hot_workspace_root())


def _default_notifications() -> list[dict[str, Any]]:
    return []


def _default_risk_control() -> dict[str, Any]:
    return {
        "status": "none",
        "level": "normal",
        "summary": "",
        "requires_user_confirmation": False,
        "confirmation_channel": "",
        "requested_by": "",
        "approved_by": "",
        "approval_status": "not_required",
        "approval_reason": "",
        "updated_at": "",
        "operations": [],
    }


def _normalize_notifications(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        normalized.append({
            "id": str(item.get("id") or "").strip() or f"note-{len(normalized) + 1}",
            "kind": str(item.get("kind") or "info").strip() or "info",
            "title": str(item.get("title") or "通知").strip() or "通知",
            "message": str(item.get("message") or "").strip(),
            "source": str(item.get("source") or item.get("agent") or "system").strip() or "system",
            "severity": str(item.get("severity") or "info").strip() or "info",
            "requires_ack": bool(item.get("requires_ack", False)),
            "acknowledged": bool(item.get("acknowledged", False)),
            "created_at": str(item.get("created_at") or item.get("at") or utc_now_iso()),
            "updated_at": str(item.get("updated_at") or item.get("created_at") or item.get("at") or utc_now_iso()),
            "task_id": str(item.get("task_id") or "").strip(),
            "task_code": str(item.get("task_code") or "").strip(),
            "meta": item.get("meta") if isinstance(item.get("meta"), dict) else {},
        })
    return normalized[-20:]


def _normalize_risk_control(value: dict[str, Any] | None) -> dict[str, Any]:
    current = value or {}
    defaults = _default_risk_control()
    operations = current.get("operations") if isinstance(current.get("operations"), list) else []
    defaults.update({
        "status": str(current.get("status") or defaults["status"]),
        "level": str(current.get("level") or defaults["level"]),
        "summary": str(current.get("summary") or defaults["summary"]),
        "requires_user_confirmation": bool(current.get("requires_user_confirmation", defaults["requires_user_confirmation"])),
        "confirmation_channel": str(current.get("confirmation_channel") or defaults["confirmation_channel"]),
        "requested_by": str(current.get("requested_by") or defaults["requested_by"]),
        "approved_by": str(current.get("approved_by") or defaults["approved_by"]),
        "approval_status": str(current.get("approval_status") or defaults["approval_status"]),
        "approval_reason": str(current.get("approval_reason") or defaults["approval_reason"]),
        "updated_at": str(current.get("updated_at") or defaults["updated_at"]),
        "operations": [op for op in operations if isinstance(op, dict)][-10:],
    })
    return defaults


def push_workspace_notification(
    task: dict[str, Any],
    *,
    title: str,
    message: str,
    source: str = "system",
    kind: str = "info",
    severity: str = "info",
    requires_ack: bool = False,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_meta = dict(task.get("meta") or {})
    workspace = dict(task_meta.get("workspace") or {})
    notifications = _normalize_notifications(workspace.get("notifications") or _default_notifications())
    timestamp = utc_now_iso()
    notifications.append({
        "id": f"{source}-{len(notifications) + 1}-{timestamp.replace(':', '').replace('-', '')}",
        "kind": kind,
        "title": title,
        "message": message,
        "source": source,
        "severity": severity,
        "requires_ack": requires_ack,
        "acknowledged": False,
        "created_at": timestamp,
        "updated_at": timestamp,
        "task_id": str(task.get("task_id") or ""),
        "task_code": str(workspace.get("task_code") or ""),
        "meta": meta or {},
    })
    workspace["notifications"] = _normalize_notifications(notifications)
    task_meta["workspace"] = workspace
    task["meta"] = task_meta
    return task_meta


def set_workspace_risk_control(
    task: dict[str, Any],
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
) -> dict[str, Any]:
    task_meta = dict(task.get("meta") or {})
    workspace = dict(task_meta.get("workspace") or {})
    risk_control = _normalize_risk_control(workspace.get("risk_control") or _default_risk_control())
    risk_control.update({
        "status": status,
        "level": level,
        "summary": summary,
        "requested_by": requested_by,
        "requires_user_confirmation": requires_user_confirmation,
        "confirmation_channel": confirmation_channel,
        "approval_status": approval_status,
        "approval_reason": approval_reason,
        "approved_by": approved_by,
        "updated_at": utc_now_iso(),
        "operations": [op for op in (operations or risk_control.get("operations") or []) if isinstance(op, dict)][-10:],
    })
    workspace["risk_control"] = _normalize_risk_control(risk_control)
    task_meta["workspace"] = workspace
    task["meta"] = task_meta
    return task_meta


def build_workspace_meta(
    *,
    task_id: str,
    task_code: str,
    title: str,
    description: str,
    creator: str,
    state: str,
    priority: str,
    assignee_org: str | None,
    trace_id: str,
    created_at: str,
    existing_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    existing_meta = existing_meta or {}
    workspace = dict(existing_meta.get("workspace") or {})
    size_estimate_gb = float(workspace.get("project_size_gb_estimate") or _extract_size_gb(existing_meta) or 0.0)
    task_kind = str(workspace.get("task_kind") or _classify_task_kind(existing_meta))
    cold_primary = bool(workspace.get("storage_tier") == "cold-primary" or _should_use_cold_primary(existing_meta))

    if workspace.get("path"):
        logical_paths = _logical_paths_for_workspace(workspace, task_code, title)
        actual_paths = _actual_paths_for_workspace(workspace, task_code, title)
        metadata_paths = workspace_paths(task_code, title, base_root=Path(workspace.get("metadata_mirror_path") or logical_paths["root"]).parent) if workspace.get("metadata_mirror_path") else logical_paths
    elif cold_primary:
        metadata_paths = workspace_paths(task_code, title, base_root=_metadata_mirror_root())
        actual_paths = workspace_paths(task_code, title, base_root=get_cold_workspace_root())
        logical_paths = metadata_paths
    else:
        logical_paths = workspace_paths(task_code, title, base_root=get_hot_workspace_root())
        actual_paths = logical_paths
        metadata_paths = logical_paths

    storage_tier = workspace.get("storage_tier") or ("cold-primary" if cold_primary else "hot")
    processing_location = workspace.get("processing_location") or ("cold" if cold_primary else "hot")
    linked_tasks = workspace.get("linked_tasks") or []
    watchdog = workspace.get("watchdog") or {}
    feishu_reporting = workspace.get("feishu_reporting") or {}
    notifications = _normalize_notifications(workspace.get("notifications") or _default_notifications())
    risk_control = _normalize_risk_control(workspace.get("risk_control") or _default_risk_control())
    task_policy = workspace.get("task_policy") or _build_task_policy(task_kind, size_estimate_gb=size_estimate_gb)

    return {
        **existing_meta,
        "workspace": {
            "task_code": task_code,
            "trace_id": trace_id,
            "path": logical_paths["root"],
            "readme_path": logical_paths["readme"],
            "todo_path": logical_paths["todo"],
            "taskrecord_path": logical_paths["taskrecord"],
            "handoff_path": logical_paths["handoff"],
            "links_path": logical_paths["links"],
            "status_path": logical_paths["status"],
            "context_dir": logical_paths["context_dir"],
            "context_latest_path": logical_paths["context_latest"],
            "continuation_hint_path": logical_paths["continuation_hint"],
            "snapshots_dir": logical_paths["snapshots_dir"],
            "ledger_dir": actual_paths["ledger_dir"],
            "artifacts_dir": actual_paths["artifacts_dir"],
            "agent_notes_dir": actual_paths["agent_notes_dir"],
            "exports_dir": logical_paths["exports_dir"],
            "resume_export_path": logical_paths["resume_export"],
            "actual_workspace_path": actual_paths["root"],
            "metadata_mirror_path": metadata_paths["root"] if metadata_paths["root"] != actual_paths["root"] else "",
            "storage_tier": storage_tier,
            "processing_location": processing_location,
            "project_size_gb_estimate": size_estimate_gb,
            "task_kind": task_kind,
            "archive_status": workspace.get("archive_status", "hot"),
            "cold_archive_path": workspace.get("cold_archive_path", actual_paths["root"] if cold_primary else ""),
            "reactivation_target_path": workspace.get("reactivation_target_path", ""),
            "linked_tasks": linked_tasks,
            "refresh_recommended": bool(workspace.get("refresh_recommended", False)),
            "task_policy": task_policy,
            "new_refresh": workspace.get(
                "new_refresh",
                {
                    "should_refresh": False,
                    "severity": "normal",
                    "reason": "当前上下文规模与任务链路仍在可直接续接范围内。",
                    "trigger_codes": [],
                    "recommended_action": "暂不需要触发 /new，可直接沿当前工作区继续推进。",
                    "resume_order": [
                        "README.md",
                        "HANDOFF.md",
                        "TODO.md",
                        "TASK_RECORD.json",
                        "context/latest_context.json",
                    ],
                    "updated_at": created_at,
                },
            ),
            "latest_summary": workspace.get("latest_summary", description or "任务已创建，等待推进。"),
            "latest_handoff": workspace.get("latest_handoff", "请先查看 README、TODO 和 TASK_RECORD，再继续下一步。"),
            "context_resume_files": workspace.get(
                "context_resume_files",
                task_policy.get("resume_files") or ["README.md", "HANDOFF.md", "TODO.md", "context/latest_context.json"],
            ),
            "created_at": workspace.get("created_at", created_at),
            "last_event_at": workspace.get("last_event_at", created_at),
            "last_progress_at": workspace.get("last_progress_at", created_at),
            "task_index_version": 2,
            "watchdog": {
                "status": watchdog.get("status", "unknown"),
                "checked_at": watchdog.get("checked_at", ""),
                "issues": watchdog.get("issues", []),
                "repairs": watchdog.get("repairs", []),
                "last_error": watchdog.get("last_error", ""),
                "recommended_action": watchdog.get("recommended_action", ""),
            },
            "notifications": notifications,
            "risk_control": risk_control,
            "feishu_reporting": feishu_reporting,
            "task_stub": {
                "task_id": task_id,
                "task_code": task_code,
                "title": title,
                "description": description,
                "creator": creator,
                "state": state,
                "priority": priority,
                "assignee_org": assignee_org or "",
            },
        },
    }


def _todo_mark(todo: dict[str, Any]) -> str:
    status = str(todo.get("status") or "not-started")
    mark = "x" if status == "completed" else " "
    detail = str(todo.get("detail") or "").strip()
    suffix = f" —— {detail}" if detail else ""
    return f"- [{mark}] {todo.get('title', '未命名待办')}{suffix}"


def render_todo_markdown(todos: list[dict[str, Any]] | None = None) -> str:
    todos = todos or []
    lines = ["# Todo", "", "## 当前待办", ""]
    if not todos:
        lines.append("- [ ] 待补充任务拆解")
    else:
        lines.extend(_todo_mark(todo) for todo in todos)
    lines.extend(["", "## 说明", "", "本文件用于跨 agent、跨任务和刷新上下文后的恢复，请优先维护。", ""])
    return "\n".join(lines)


def render_readme(task: dict[str, Any], workspace_meta: dict[str, Any]) -> str:
    linked_tasks = workspace_meta.get("linked_tasks") or []
    latest_summary = workspace_meta.get("latest_summary") or task.get("description") or "暂无摘要"
    latest_handoff = workspace_meta.get("latest_handoff") or "请结合 Todo 和 taskrecord 继续推进。"
    new_refresh = workspace_meta.get("new_refresh") or {}
    new_refresh_line = new_refresh.get("recommended_action") or "暂不需要触发 /new，可直接沿当前工作区推进。"
    lines = [
        f"# 任务工作区：{task.get('title')}",
        "",
        "## 任务概况",
        "",
        f"- 任务代号：**{workspace_meta.get('task_code', '')}**",
        f"- 任务 ID：`{task.get('task_id', '')}`",
        f"- 当前状态：`{task.get('state', '')}`",
        f"- 当前负责：`{task.get('org', '') or task.get('assignee_org', '') or task.get('creator', '')}`",
        f"- 优先级：`{task.get('priority', '')}`",
        f"- 任务类型：`{workspace_meta.get('task_kind', 'standard')}`",
        f"- 存储层级：`{workspace_meta.get('storage_tier', 'hot')}`",
        f"- 当前处理位置：`{workspace_meta.get('processing_location', 'hot')}`",
        f"- 逻辑工作区：`{workspace_meta.get('path', '')}`",
        f"- 实际工作区：`{workspace_meta.get('actual_workspace_path', workspace_meta.get('path', ''))}`",
        f"- 冷归档路径：`{workspace_meta.get('cold_archive_path', '')}`",
        f"- /new 建议级别：`{new_refresh.get('severity', 'normal')}`",
        f"- /new 判断：{new_refresh_line}",
        f"- 最近更新时间：`{workspace_meta.get('last_event_at', task.get('updated_at', '') or task.get('created_at', ''))}`",
        "",
        "## 当前结论",
        "",
        latest_summary,
        "",
        "## 下一步建议",
        "",
        latest_handoff,
        "",
        "## 恢复顺序",
        "",
        "1. 阅读 `README.md` 了解整体情况。",
        "2. 阅读 `HANDOFF.md` 明确当前接力点。",
        "3. 阅读 `TODO.md` 确认未完成事项。",
        "4. 需要精确状态时读取 `TASK_RECORD.json` 与 `context/latest_context.json`。",
        "5. 需要审计历史时读取实际工作区中的 `ledger/*.jsonl`。",
        "",
        "## 任务链路",
        "",
    ]
    if not linked_tasks:
        lines.append("当前暂无关联任务。")
    else:
        for item in linked_tasks:
            relation = item.get("relation") or "related"
            target = item.get("task_code") or item.get("task_id") or "未知任务"
            lines.append(f"- `{relation}` → `{target}`")
    lines.append("")
    return "\n".join(lines)


def render_handoff(task: dict[str, Any], workspace_meta: dict[str, Any]) -> str:
    new_refresh = workspace_meta.get("new_refresh") or {}
    return "\n".join([
        "# 当前交接说明",
        "",
        f"- 任务代号：**{workspace_meta.get('task_code', '')}**",
        f"- 当前状态：`{task.get('state', '')}`",
        f"- 当前说明：{task.get('now') or task.get('description') or '暂无说明'}",
        f"- 当前处理位置：`{workspace_meta.get('processing_location', 'hot')}`",
        f"- /new 建议：{new_refresh.get('recommended_action', '暂不需要触发 /new。')}",
        "",
        "## 建议下一步",
        "",
        workspace_meta.get("latest_handoff") or "请先补齐 Todo 与进展记录后继续。",
        "",
    ])


def render_links(task: dict[str, Any], workspace_meta: dict[str, Any]) -> str:
    linked_tasks = workspace_meta.get("linked_tasks") or []
    lines = [
        "# 任务链路",
        "",
        f"- 当前任务：`{task.get('task_id', '')}`",
        f"- 任务代号：**{workspace_meta.get('task_code', '')}**",
        "",
    ]
    if not linked_tasks:
        lines.append("暂无关联任务。")
    else:
        for item in linked_tasks:
            relation = item.get("relation") or "related"
            target = item.get("task_code") or item.get("task_id") or "未知任务"
            title = item.get("title") or ""
            extra = f" —— {title}" if title else ""
            lines.append(f"- `{relation}` → `{target}`{extra}")
    lines.append("")
    return "\n".join(lines)


def _build_stats(task: dict[str, Any]) -> dict[str, int]:
    todos = task.get("todos") or []
    progress = task.get("progress_log") or []
    flows = task.get("flow_log") or []
    done = sum(1 for item in todos if str(item.get("status") or "") == "completed")
    return {
        "todo_total": len(todos),
        "todo_done": done,
        "progress_count": len(progress),
        "flow_count": len(flows),
    }


def _latest_progress_summary(task: dict[str, Any]) -> str:
    progress = task.get("progress_log") or []
    if progress:
        latest = progress[-1]
        return str(latest.get("content") or latest.get("text") or "").strip() or "已有进展记录，待继续推进。"
    return str(task.get("now") or task.get("description") or "任务已创建，待推进。")


def _build_new_refresh_advice(task: dict[str, Any], workspace: dict[str, Any]) -> dict[str, Any]:
    context_window = (task.get("meta") or {}).get("context_window") or {}
    progress_log = task.get("progress_log") or []
    flow_log = task.get("flow_log") or []
    todos = task.get("todos") or []
    watchdog = workspace.get("watchdog") or {}

    open_todos = [
        item for item in todos
        if str(item.get("status") or "not-started") != "completed"
    ]
    in_progress_todos = [
        item for item in todos
        if str(item.get("status") or "not-started") == "in-progress"
    ]

    trigger_codes: list[str] = []
    reasons: list[str] = []
    severity = "normal"

    context_status = str(context_window.get("status") or "").strip().lower()
    if context_status in {"warning", "critical", "compressed", "overflow"}:
        trigger_codes.append(f"context_{context_status}")
        reasons.append(f"上下文窗口状态为 {context_status}")
        severity = "recommended" if context_status in {"warning", "compressed"} else "required"

    if len(progress_log) >= 12:
        trigger_codes.append("progress_log_dense")
        reasons.append(f"进展记录已累计 {len(progress_log)} 条")
        if severity == "normal":
            severity = "suggested"

    if len(flow_log) >= 16:
        trigger_codes.append("flow_log_dense")
        reasons.append(f"流转记录已累计 {len(flow_log)} 条")
        if severity == "normal":
            severity = "suggested"

    if len(in_progress_todos) >= 4:
        trigger_codes.append("todo_parallel_high")
        reasons.append(f"存在 {len(in_progress_todos)} 个进行中的待办")
        if severity == "normal":
            severity = "suggested"

    if watchdog.get("status") in {"attention", "warning", "critical"}:
        trigger_codes.append(f"watchdog_{watchdog.get('status')}")
        reasons.append(f"看门狗状态为 {watchdog.get('status')}")
        if severity == "normal":
            severity = "recommended"

    should_refresh = severity in {"suggested", "recommended", "required"}
    reason_text = "；".join(reasons) if reasons else "当前上下文规模与任务链路仍在可直接续接范围内。"

    if severity == "required":
        action_text = "建议先写交接摘要并立即触发 /new，再按 README → HANDOFF → TODO → TASK_RECORD → context/latest_context.json 的顺序恢复。"
    elif severity == "recommended":
        action_text = "建议本轮收尾后触发 /new，避免继续堆叠历史上下文。"
    elif severity == "suggested":
        action_text = "如果下一步需要切换负责 agent、切换子任务或展开新阶段，建议触发 /new。"
    else:
        action_text = "暂不需要触发 /new，可直接沿当前工作区继续推进。"

    return {
        "should_refresh": should_refresh,
        "severity": severity,
        "reason": reason_text,
        "trigger_codes": trigger_codes,
        "open_todo_count": len(open_todos),
        "in_progress_todo_count": len(in_progress_todos),
        "progress_count": len(progress_log),
        "flow_count": len(flow_log),
        "recommended_action": action_text,
        "resume_order": [
            "README.md",
            "HANDOFF.md",
            "TODO.md",
            "TASK_RECORD.json",
            "context/latest_context.json",
        ],
        "updated_at": utc_now_iso(),
    }


def _ensure_actual_workspace_layout(actual_root: Path) -> None:
    actual_root.mkdir(parents=True, exist_ok=True)
    for dirname in [
        "context/snapshots",
        "ledger",
        "artifacts/drafts",
        "artifacts/outputs",
        "artifacts/references",
        "artifacts/attachments",
        "agent_notes",
        "exports",
    ]:
        (actual_root / dirname).mkdir(parents=True, exist_ok=True)


def _ensure_logical_workspace_layout(logical_root: Path) -> None:
    logical_root.mkdir(parents=True, exist_ok=True)
    for dirname in ["context/snapshots", "exports"]:
        (logical_root / dirname).mkdir(parents=True, exist_ok=True)


def _required_logical_files(workspace: dict[str, Any]) -> list[Path]:
    return [
        Path(workspace["readme_path"]),
        Path(workspace["todo_path"]),
        Path(workspace["taskrecord_path"]),
        Path(workspace["handoff_path"]),
        Path(workspace["links_path"]),
        Path(workspace["status_path"]),
        Path(workspace["context_latest_path"]),
        Path(workspace["continuation_hint_path"]),
        Path(workspace["resume_export_path"]),
    ]


def _required_actual_paths(workspace: dict[str, Any]) -> list[Path]:
    return [
        Path(workspace.get("actual_workspace_path") or workspace.get("path") or ""),
        Path(workspace.get("ledger_dir") or ""),
        Path(workspace.get("artifacts_dir") or ""),
        Path(workspace.get("agent_notes_dir") or ""),
    ]


def refresh_workspace_snapshot(task: dict[str, Any]) -> dict[str, Any]:
    meta = dict(task.get("meta") or {})
    workspace = dict(meta.get("workspace") or {})
    if not workspace.get("path"):
        return meta

    task_code = workspace.get("task_code") or str(task.get("task_code") or task.get("taskCode") or "")
    title = str(task.get("title") or "")

    logical_root = Path(workspace["path"])
    actual_root = Path(workspace.get("actual_workspace_path") or workspace["path"])
    logical_paths = workspace_paths(task_code, title, base_root=logical_root.parent)
    actual_paths = workspace_paths(task_code, title, base_root=actual_root.parent)

    workspace["path"] = logical_paths["root"]
    workspace["readme_path"] = logical_paths["readme"]
    workspace["todo_path"] = logical_paths["todo"]
    workspace["taskrecord_path"] = logical_paths["taskrecord"]
    workspace["handoff_path"] = logical_paths["handoff"]
    workspace["links_path"] = logical_paths["links"]
    workspace["status_path"] = logical_paths["status"]
    workspace["context_dir"] = logical_paths["context_dir"]
    workspace["context_latest_path"] = logical_paths["context_latest"]
    workspace["continuation_hint_path"] = logical_paths["continuation_hint"]
    workspace["snapshots_dir"] = logical_paths["snapshots_dir"]
    workspace["exports_dir"] = logical_paths["exports_dir"]
    workspace["resume_export_path"] = logical_paths["resume_export"]
    workspace["actual_workspace_path"] = actual_paths["root"]
    workspace["ledger_dir"] = actual_paths["ledger_dir"]
    workspace["artifacts_dir"] = actual_paths["artifacts_dir"]
    workspace["agent_notes_dir"] = actual_paths["agent_notes_dir"]

    logical_root = Path(workspace["path"])
    actual_root = Path(workspace["actual_workspace_path"])
    _ensure_actual_workspace_layout(actual_root)
    _ensure_logical_workspace_layout(logical_root)

    if workspace.get("metadata_mirror_path"):
        workspace["metadata_mirror_path"] = logical_paths["root"]

    workspace["latest_summary"] = _latest_progress_summary(task)
    workspace["last_event_at"] = task.get("updated_at") or task.get("updatedAt") or utc_now_iso()
    workspace["last_progress_at"] = (task.get("progress_log") or [{}])[-1].get("at") if (task.get("progress_log") or []) else workspace["last_event_at"]
    workspace["refresh_recommended"] = bool(
        workspace.get("refresh_recommended")
        or (task.get("meta") or {}).get("context_window", {}).get("status") in {"warning", "critical", "compressed", "overflow"}
        or len(task.get("progress_log") or []) >= 12
        or len(task.get("flow_log") or []) >= 16
    )
    workspace["task_policy"] = workspace.get("task_policy") or _build_task_policy(
        str(workspace.get("task_kind") or "standard"),
        size_estimate_gb=float(workspace.get("project_size_gb_estimate") or 0.0),
    )
    workspace["notifications"] = _normalize_notifications(workspace.get("notifications") or _default_notifications())
    workspace["risk_control"] = _normalize_risk_control(workspace.get("risk_control") or _default_risk_control())
    workspace["context_resume_files"] = workspace.get("context_resume_files") or workspace["task_policy"].get("resume_files") or []
    workspace["new_refresh"] = _build_new_refresh_advice(task, workspace)

    task_record = {
        "task_id": task.get("task_id", ""),
        "trace_id": task.get("trace_id", ""),
        "task_code": workspace.get("task_code", ""),
        "title": task.get("title", ""),
        "description": task.get("description", ""),
        "created_at": task.get("created_at") or task.get("createdAt") or utc_now_iso(),
        "updated_at": task.get("updated_at") or task.get("updatedAt") or utc_now_iso(),
        "state": task.get("state", ""),
        "priority": task.get("priority", ""),
        "creator": task.get("creator", ""),
        "current_owner": task.get("owner") or task.get("creator") or "",
        "current_org": task.get("org") or task.get("assignee_org") or "",
        "workspace_path": workspace.get("path", ""),
        "actual_workspace_path": workspace.get("actual_workspace_path", workspace.get("path", "")),
        "metadata_mirror_path": workspace.get("metadata_mirror_path", ""),
        "storage_tier": workspace.get("storage_tier", "hot"),
        "processing_location": workspace.get("processing_location", "hot"),
        "project_size_gb_estimate": workspace.get("project_size_gb_estimate", 0),
        "task_kind": workspace.get("task_kind", "standard"),
        "archive_status": workspace.get("archive_status", "hot"),
        "cold_archive_path": workspace.get("cold_archive_path", ""),
        "latest_summary": workspace.get("latest_summary", ""),
        "latest_handoff": workspace.get("latest_handoff", ""),
        "context_refresh_recommended": workspace.get("refresh_recommended", False),
        "task_policy": workspace.get("task_policy") or {},
        "new_refresh": workspace.get("new_refresh") or {},
        "context_resume_files": workspace.get("context_resume_files") or [],
        "linked_tasks": workspace.get("linked_tasks") or [],
        "watchdog": workspace.get("watchdog") or {},
        "notifications": _normalize_notifications(workspace.get("notifications") or _default_notifications()),
        "risk_control": _normalize_risk_control(workspace.get("risk_control") or _default_risk_control()),
        "feishu_reporting": workspace.get("feishu_reporting") or {},
        "stats": _build_stats(task),
    }
    status_payload = {
        "task_id": task_record["task_id"],
        "task_code": task_record["task_code"],
        "state": task_record["state"],
        "archive_status": task_record["archive_status"],
        "storage_tier": task_record["storage_tier"],
        "processing_location": task_record["processing_location"],
        "updated_at": task_record["updated_at"],
        "refresh_recommended": task_record["context_refresh_recommended"],
        "task_policy": task_record["task_policy"],
        "new_refresh": task_record["new_refresh"],
        "latest_summary": task_record["latest_summary"],
        "stats": task_record["stats"],
        "linked_tasks": task_record["linked_tasks"],
        "watchdog": task_record["watchdog"],
        "notifications": task_record["notifications"],
        "risk_control": task_record["risk_control"],
        "feishu_reporting": task_record["feishu_reporting"],
    }
    latest_context = {
        "task": {
            "task_id": task.get("task_id", ""),
            "task_code": workspace.get("task_code", ""),
            "title": task.get("title", ""),
            "state": task.get("state", ""),
            "org": task.get("org") or task.get("assignee_org") or "",
            "priority": task.get("priority", ""),
            "task_kind": workspace.get("task_kind", "standard"),
            "processing_location": workspace.get("processing_location", "hot"),
        },
        "latest_summary": workspace.get("latest_summary", ""),
        "latest_handoff": workspace.get("latest_handoff", ""),
        "task_policy": workspace.get("task_policy") or {},
        "feishu_reporting": workspace.get("feishu_reporting") or {},
        "notifications": _normalize_notifications(workspace.get("notifications") or _default_notifications()),
        "risk_control": _normalize_risk_control(workspace.get("risk_control") or _default_risk_control()),
        "new_refresh": workspace.get("new_refresh") or {},
        "todos": task.get("todos") or [],
        "flow_log_tail": (task.get("flow_log") or [])[-10:],
        "progress_log_tail": (task.get("progress_log") or [])[-10:],
        "context_window": (task.get("meta") or {}).get("context_window") or {},
        "exported_at": utc_now_iso(),
    }

    _write_text(Path(workspace["todo_path"]), render_todo_markdown(task.get("todos") or []))
    _write_text(Path(workspace["readme_path"]), render_readme(task, workspace))
    _write_text(Path(workspace["handoff_path"]), render_handoff(task, workspace))
    _write_text(Path(workspace["links_path"]), render_links(task, workspace))
    _write_json(Path(workspace["taskrecord_path"]), task_record)
    _write_json(Path(workspace["status_path"]), status_payload)
    _write_json(Path(workspace["context_latest_path"]), latest_context)
    _write_text(
        Path(workspace["continuation_hint_path"]),
        "\n".join([
            f"任务代号：{workspace.get('task_code', '')}",
            f"当前状态：{task.get('state', '')}",
            f"最近摘要：{workspace.get('latest_summary', '')}",
            f"建议下一步：{workspace.get('latest_handoff', '')}",
            f"/new 建议：{((workspace.get('new_refresh') or {}).get('recommended_action') or '暂不需要触发 /new。')}",
            "恢复时请按 README → HANDOFF → TODO → TASK_RECORD 的顺序读取。",
            "",
        ]),
    )
    _write_text(
        Path(workspace["resume_export_path"]),
        "\n".join([
            f"# 任务续接摘要：{task.get('title', '')}",
            "",
            f"- 任务代号：**{workspace.get('task_code', '')}**",
            f"- 当前状态：`{task.get('state', '')}`",
            f"- 最近摘要：{workspace.get('latest_summary', '')}",
            f"- 下一步建议：{workspace.get('latest_handoff', '')}",
            f"- /new 建议：{((workspace.get('new_refresh') or {}).get('recommended_action') or '暂不需要触发 /new。')}",
            f"- 当前处理位置：`{workspace.get('processing_location', 'hot')}`",
            "",
        ]),
    )

    meta["workspace"] = workspace
    return meta


def _index_paths() -> tuple[Path, Path]:
    TASK_WORKSPACE_INDEX_DIR.mkdir(parents=True, exist_ok=True)
    return TASK_WORKSPACE_INDEX_DIR / "task_index.json", TASK_WORKSPACE_INDEX_DIR / "archive_index.json"


def update_workspace_indexes(task: dict[str, Any]) -> None:
    workspace = ((task.get("meta") or {}).get("workspace") or {})
    task_code = workspace.get("task_code")
    task_id = task.get("task_id", "")
    if not task_code or not task_id:
        return
    task_index_path, archive_index_path = _index_paths()
    task_index = _read_json(task_index_path, {"by_task_code": {}, "by_task_id": {}})
    archive_index = _read_json(archive_index_path, {"items": {}, "by_task_id": {}, "by_task_code": {}})

    watchdog = workspace.get("watchdog") or {}
    new_refresh = workspace.get("new_refresh") or {}
    item = {
        "task_id": task_id,
        "task_code": task_code,
        "title": task.get("title", ""),
        "workspace_path": workspace.get("path", ""),
        "actual_workspace_path": workspace.get("actual_workspace_path", workspace.get("path", "")),
        "metadata_mirror_path": workspace.get("metadata_mirror_path", ""),
        "storage_tier": workspace.get("storage_tier", "hot"),
        "processing_location": workspace.get("processing_location", "hot"),
        "task_kind": workspace.get("task_kind", "standard"),
        "project_size_gb_estimate": workspace.get("project_size_gb_estimate", 0),
        "archive_status": workspace.get("archive_status", "hot"),
        "cold_archive_path": workspace.get("cold_archive_path", ""),
        "state": task.get("state", ""),
        "updated_at": task.get("updated_at") or task.get("updatedAt") or utc_now_iso(),
        "refresh_recommended": bool(workspace.get("refresh_recommended", False)),
        "watchdog_status": watchdog.get("status", ""),
        "task_policy": workspace.get("task_policy") or {},
        "new_refresh": new_refresh,
        "watchdog": watchdog,
        "notifications": _normalize_notifications(workspace.get("notifications") or _default_notifications()),
        "risk_control": _normalize_risk_control(workspace.get("risk_control") or _default_risk_control()),
        "feishu_reporting": workspace.get("feishu_reporting") or {},
    }
    task_index.setdefault("by_task_code", {})[task_code] = item
    task_index.setdefault("by_task_id", {})[task_id] = {
        "task_code": task_code,
        "workspace_path": workspace.get("path", ""),
        "actual_workspace_path": workspace.get("actual_workspace_path", workspace.get("path", "")),
        "metadata_mirror_path": workspace.get("metadata_mirror_path", ""),
        "storage_tier": workspace.get("storage_tier", "hot"),
        "processing_location": workspace.get("processing_location", "hot"),
        "archive_status": workspace.get("archive_status", "hot"),
        "cold_archive_path": workspace.get("cold_archive_path", ""),
        "task_kind": workspace.get("task_kind", "standard"),
        "refresh_recommended": bool(workspace.get("refresh_recommended", False)),
        "watchdog_status": watchdog.get("status", ""),
        "task_policy": workspace.get("task_policy") or {},
        "new_refresh": new_refresh,
        "watchdog": watchdog,
        "notifications": _normalize_notifications(workspace.get("notifications") or _default_notifications()),
        "risk_control": _normalize_risk_control(workspace.get("risk_control") or _default_risk_control()),
        "feishu_reporting": workspace.get("feishu_reporting") or {},
    }

    previous_archive_item = archive_index.setdefault("by_task_id", {}).get(task_id, {})
    archive_record = {
        **previous_archive_item,
        **item,
        "last_known_cold_archive_path": workspace.get("cold_archive_path")
        or previous_archive_item.get("last_known_cold_archive_path", ""),
        "currently_cold": workspace.get("archive_status") == "cold",
    }
    archive_index.setdefault("by_task_id", {})[task_id] = archive_record
    archive_index.setdefault("by_task_code", {})[task_code] = archive_record
    if workspace.get("archive_status") == "cold":
        archive_index.setdefault("items", {})[task_code] = archive_record
    else:
        archive_index.setdefault("items", {}).pop(task_code, None)

    _write_json(task_index_path, task_index)
    _write_json(archive_index_path, archive_index)


def append_workspace_event(
    task: dict[str, Any],
    event: str,
    summary: str,
    agent: str = "system",
    payload: dict[str, Any] | None = None,
    ledger_name: str = "events",
) -> None:
    workspace = ((task.get("meta") or {}).get("workspace") or {})
    ledger_dir = workspace.get("ledger_dir")
    if not ledger_dir:
        return
    ledger_path = Path(ledger_dir) / f"{ledger_name}.jsonl"
    seq = 1
    prev_hash = ""
    if ledger_path.exists():
        try:
            last_line = ledger_path.read_text(encoding="utf-8").strip().splitlines()[-1]
            last_record = json.loads(last_line)
            seq = int(last_record.get("seq") or 0) + 1
            prev_hash = str(last_record.get("hash") or "")
        except Exception:
            seq = 1
            prev_hash = ""
    record = {
        "seq": seq,
        "ts": utc_now_iso(),
        "event": event,
        "task_id": task.get("task_id", ""),
        "task_code": workspace.get("task_code", ""),
        "agent": agent,
        "summary": summary,
        "payload": payload or {},
        "prev_hash": prev_hash,
    }
    record["hash"] = _hash_record(record)
    _append_jsonl(ledger_path, record)


def run_workspace_watchdog(task: dict[str, Any], auto_repair: bool = True) -> dict[str, Any]:
    settings = get_settings()
    meta = dict(task.get("meta") or {})
    workspace = dict(meta.get("workspace") or {})
    if not workspace.get("path"):
        return meta

    issues: list[str] = []
    repairs: list[str] = []
    logical_root = Path(workspace["path"])
    actual_root = Path(workspace.get("actual_workspace_path") or workspace["path"])

    if not actual_root.exists():
        issues.append(f"actual_workspace_missing:{actual_root}")
        if auto_repair:
            _ensure_actual_workspace_layout(actual_root)
            repairs.append(f"created_actual_workspace:{actual_root}")

    if settings.workspace_watchdog_missing_file_repair:
        for req in _required_logical_files(workspace):
            if not req.exists():
                issues.append(f"missing_file:{req}")
        for req in _required_actual_paths(workspace):
            if str(req) and not req.exists():
                issues.append(f"missing_path:{req}")

    if auto_repair and issues:
        meta = refresh_workspace_snapshot(task)
        task["meta"] = meta
        workspace = dict(meta.get("workspace") or {})
        repairs.append("refreshed_workspace_snapshot")

    stale_minutes = int(settings.workspace_watchdog_stale_minutes)
    checked_at = utc_now_iso()
    updated_at_text = task.get("updated_at") or task.get("updatedAt") or workspace.get("last_event_at") or checked_at
    try:
        updated_at = datetime.fromisoformat(str(updated_at_text).replace("Z", "+00:00"))
        delta_minutes = max(0.0, (datetime.now(timezone.utc) - updated_at).total_seconds() / 60)
    except Exception:
        delta_minutes = 0.0

    status = "healthy"
    recommended_action = ""
    if delta_minutes >= stale_minutes:
        issues.append(f"stale_task:{int(delta_minutes)}m")
        status = "warning"
        recommended_action = "建议检查任务是否卡住，必要时补进展、重派发或触发 /new 刷新。"
    if any(item.startswith("missing_") or item.startswith("actual_workspace_missing") for item in issues):
        status = "repairing" if repairs else "critical"
        if not recommended_action:
            recommended_action = "请优先修复工作区与账本文件，再继续流转。"
    if workspace.get("refresh_recommended") and settings.workspace_watchdog_auto_refresh_mark:
        if status == "healthy":
            status = "attention"
        if not recommended_action:
            recommended_action = "上下文已接近上限，建议在写完交接后触发 /new。"

    new_refresh = workspace.get("new_refresh") or _build_new_refresh_advice(task, workspace)
    if new_refresh.get("severity") == "required" and status not in {"critical", "repairing"}:
        status = "attention" if status == "healthy" else status
        recommended_action = new_refresh.get("recommended_action") or recommended_action
    elif new_refresh.get("severity") == "recommended" and not recommended_action:
        recommended_action = new_refresh.get("recommended_action")

    workspace["watchdog"] = {
        "status": status,
        "checked_at": checked_at,
        "issues": issues,
        "repairs": repairs,
        "last_error": issues[-1] if issues else "",
        "recommended_action": recommended_action,
    }
    meta["workspace"] = workspace
    task["meta"] = meta
    refreshed_meta = refresh_workspace_snapshot(task)
    task["meta"] = refreshed_meta
    append_workspace_event(
        task,
        event="task.watchdog.checked",
        summary=f"看门狗巡检完成，状态：{status}",
        agent="watchdog",
        payload={"issues": issues, "repairs": repairs, "recommended_action": recommended_action},
        ledger_name="watchdog",
    )
    update_workspace_indexes(task)
    return refreshed_meta


def initialize_task_workspace(task: dict[str, Any]) -> dict[str, Any]:
    meta = refresh_workspace_snapshot(task)
    task["meta"] = meta
    append_workspace_event(task, "task.created", "任务工作区已初始化", agent="system")
    meta = run_workspace_watchdog(task, auto_repair=True)
    task["meta"] = meta
    update_workspace_indexes(task)
    return meta


def sync_workspace_for_task(
    task: dict[str, Any],
    event: str,
    summary: str,
    agent: str = "system",
    payload: dict[str, Any] | None = None,
    ledger_name: str = "events",
) -> dict[str, Any]:
    meta = refresh_workspace_snapshot(task)
    task["meta"] = meta
    append_workspace_event(task, event, summary, agent=agent, payload=payload, ledger_name=ledger_name)
    meta = run_workspace_watchdog(task, auto_repair=True)
    task["meta"] = meta
    update_workspace_indexes(task)
    return meta


def archive_task_workspace(task: dict[str, Any]) -> dict[str, Any]:
    meta = dict(task.get("meta") or {})
    workspace = dict(meta.get("workspace") or {})
    root = workspace.get("actual_workspace_path") or workspace.get("path")
    if not root:
        return meta

    source = Path(root)
    source.parent.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        _ensure_actual_workspace_layout(source)

    task_code = workspace.get("task_code") or source.name.split("__", 1)[0]
    task_policy = workspace.get("task_policy") or _build_task_policy(
        str(workspace.get("task_kind") or "standard"),
        size_estimate_gb=float(workspace.get("project_size_gb_estimate") or 0.0),
    )
    archive_strategy = str(task_policy.get("archive_strategy") or "cold-archive")

    if archive_strategy == "hot-archive":
        workspace["archive_status"] = "hot-archived"
        workspace["cold_archive_path"] = ""
        workspace["actual_workspace_path"] = str(source)
        workspace["processing_location"] = "hot"
        payload = {"archive_mode": "hot", "workspace_path": str(source)}
        summary = "轻量任务已完成热盘归档，保留原位以减少迁移成本。"
    else:
        target_dir = get_cold_workspace_root() / source.name
        target_dir.parent.mkdir(parents=True, exist_ok=True)

        if source.resolve() != target_dir.resolve():
            if target_dir.exists():
                shutil.rmtree(target_dir)
            shutil.move(str(source), str(target_dir))

        workspace["archive_status"] = "cold"
        workspace["cold_archive_path"] = str(target_dir)
        workspace["actual_workspace_path"] = str(target_dir)
        workspace["processing_location"] = "cold"
        if not workspace.get("metadata_mirror_path"):
            workspace["metadata_mirror_path"] = workspace_paths(task_code, task.get("title", ""), base_root=_metadata_mirror_root())["root"]
            mirror_paths = workspace_paths(task_code, task.get("title", ""), base_root=Path(workspace["metadata_mirror_path"]).parent)
            workspace["path"] = mirror_paths["root"]
            workspace["readme_path"] = mirror_paths["readme"]
            workspace["todo_path"] = mirror_paths["todo"]
            workspace["taskrecord_path"] = mirror_paths["taskrecord"]
            workspace["handoff_path"] = mirror_paths["handoff"]
            workspace["links_path"] = mirror_paths["links"]
            workspace["status_path"] = mirror_paths["status"]
            workspace["context_dir"] = mirror_paths["context_dir"]
            workspace["context_latest_path"] = mirror_paths["context_latest"]
            workspace["continuation_hint_path"] = mirror_paths["continuation_hint"]
            workspace["snapshots_dir"] = mirror_paths["snapshots_dir"]
            workspace["exports_dir"] = mirror_paths["exports_dir"]
            workspace["resume_export_path"] = mirror_paths["resume_export"]
        payload = {"archive_mode": "cold", "cold_archive_path": str(target_dir)}
        summary = "任务工作区已迁移到冷归档目录"

    meta["workspace"] = workspace
    task["meta"] = meta
    append_workspace_event(
        task,
        "task.archived",
        summary,
        agent="system",
        payload=payload,
        ledger_name="archive",
    )
    refreshed = refresh_workspace_snapshot(task)
    task["meta"] = refreshed
    update_workspace_indexes(task)
    return refreshed


def reactivate_task_workspace(task: dict[str, Any], *, move_to_hot: bool | None = None) -> dict[str, Any]:
    settings = get_settings()
    meta = dict(task.get("meta") or {})
    workspace = dict(meta.get("workspace") or {})
    source_path = workspace.get("actual_workspace_path") or workspace.get("cold_archive_path") or workspace.get("path")
    if not source_path:
        return meta

    if workspace.get("archive_status") == "hot-archived":
        source = Path(workspace.get("actual_workspace_path") or workspace.get("path") or source_path)
        if not source.exists():
            _ensure_actual_workspace_layout(source)
        workspace["actual_workspace_path"] = str(source)
        workspace["processing_location"] = "hot"
        workspace["archive_status"] = "hot"
        workspace["cold_archive_path"] = ""
        workspace["reactivation_target_path"] = str(source)
        payload = {"reactivated_to": str(source), "mode": "hot-inplace"}
    else:
        move_to_hot = settings.task_workspace_reactivate_to_hot if move_to_hot is None else move_to_hot
        source = Path(source_path)
        if not source.exists() and workspace.get("cold_archive_path"):
            source = Path(workspace["cold_archive_path"])
        if not source.exists():
            _ensure_actual_workspace_layout(source)

        if move_to_hot:
            target = get_hot_workspace_root() / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.resolve() != target.resolve():
                if target.exists():
                    shutil.rmtree(target)
                shutil.move(str(source), str(target))
            workspace["actual_workspace_path"] = str(target)
            workspace["processing_location"] = "hot"
            workspace["archive_status"] = "hot"
            workspace["cold_archive_path"] = ""
            if not workspace.get("metadata_mirror_path"):
                workspace["path"] = str(target)
            workspace["reactivation_target_path"] = str(target)
            payload = {"reactivated_to": str(target), "mode": "hot"}
        else:
            workspace["actual_workspace_path"] = str(source)
            workspace["processing_location"] = "cold"
            workspace["archive_status"] = "hot"
            workspace["cold_archive_path"] = str(source)
            workspace["reactivation_target_path"] = str(source)
            payload = {"reactivated_to": str(source), "mode": "cold"}

    meta["workspace"] = workspace
    task["meta"] = meta
    append_workspace_event(
        task,
        "task.reactivated",
        "任务工作区已重新激活，可继续处理。",
        agent="system",
        payload=payload,
        ledger_name="archive",
    )
    refreshed = refresh_workspace_snapshot(task)
    task["meta"] = refreshed
    update_workspace_indexes(task)
    return refreshed


__all__ = [
    "TASK_WORKSPACE_ROOT",
    "COLD_ARCHIVE_ROOT",
    "build_workspace_meta",
    "generate_task_code",
    "initialize_task_workspace",
    "sync_workspace_for_task",
    "archive_task_workspace",
    "reactivate_task_workspace",
    "run_workspace_watchdog",
    "get_hot_workspace_root",
    "get_cold_workspace_root",
]
