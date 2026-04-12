"""Compatibility API endpoints for dashboard-era frontend contracts."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.task import Task, TaskState
from ..services.task_service import TaskService
from ..services.event_bus import get_event_bus

router = APIRouter()
DATA_DIR = Path(__file__).parents[4] / "data"


def _read_json_file(name: str, default: Any):
    path = DATA_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


async def get_task_service(
    db: AsyncSession = Depends(get_db),
) -> TaskService:
    bus = await get_event_bus()
    return TaskService(db, bus)


@router.get("/api/live-status")
async def live_status_compat(svc: TaskService = Depends(get_task_service)):
    """Provide `/api/live-status` for legacy dashboard consumers.

    Backend canonical endpoint is `/api/tasks/live-status` and returns task maps.
    This compatibility view converts maps to arrays and includes `syncStatus`.
    """
    status = await svc.get_live_status()
    active_tasks = list((status.get("tasks") or {}).values())
    completed_tasks = list((status.get("completed_tasks") or {}).values())
    tasks = active_tasks + completed_tasks
    tasks.sort(key=lambda item: str(item.get("updatedAt") or item.get("updated_at") or ""), reverse=True)
    return {
        "tasks": tasks,
        "syncStatus": {
            "ok": True,
            "source": "backend-compat",
            "lastUpdated": status.get("last_updated"),
        },
        "last_updated": status.get("last_updated"),
    }


@router.get("/api/auth/status")
async def auth_status_compat():
    """Backend-only mode auth compatibility (no dashboard session required)."""
    return {
        "authenticated": True,
        "mustChangePassword": False,
        "currentUser": "backend",
        "username": "backend",
        "ok": True,
    }


@router.get("/api/agent-config")
async def agent_config_compat():
    """Provide a minimal legacy payload so frontend can boot in backend-only mode."""
    cfg_path = Path(__file__).parents[4] / "data" / "agent_config.json"
    if cfg_path.exists():
        try:
            payload = json.loads(cfg_path.read_text(encoding="utf-8"))
            payload["ok"] = True
            return payload
        except (json.JSONDecodeError, OSError):
            pass
    return {"agents": [], "knownModels": [], "dispatchChannel": "openclaw", "ok": True}


@router.get("/api/model-change-log")
async def model_change_log_compat():
    payload = _read_json_file("model_change_log.json", [])
    return payload if isinstance(payload, list) else []


@router.get("/api/agents-overview")
async def agents_overview_compat():
    payload = _read_json_file("agents_overview.json", {})
    if isinstance(payload, dict) and isinstance(payload.get("agents"), list):
        return payload
    return {"agents": [], "totals": {"tasks_done": 0, "cost_cny": 0}, "top_agent": ""}


@router.get("/api/agents-status")
async def agents_status_compat():
    payload = _read_json_file("agents_status.json", {})
    if isinstance(payload, dict) and isinstance(payload.get("agents"), list):
        return payload
    return {
        "ok": True,
        "gateway": {"alive": False, "probe": False, "status": "unknown"},
        "agents": [],
        "checkedAt": "",
    }


@router.get("/api/search-brief")
async def search_brief_compat():
    payload = _read_json_file("search_brief.json", {})
    return payload if isinstance(payload, dict) else {}


@router.get("/api/search-config")
async def search_config_compat():
    payload = _read_json_file("search_config.json", {})
    return payload if isinstance(payload, dict) else {}


@router.post("/api/search-config")
async def save_search_config_compat(body: dict[str, Any]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "search_config.json"
    path.write_text(json.dumps(body or {}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True}


@router.get("/api/system-settings")
async def system_settings_compat():
    payload = _read_json_file("system_settings.json", {})
    return payload if isinstance(payload, dict) else {}


@router.post("/api/system-settings")
async def save_system_settings_compat(body: dict[str, Any]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "system_settings.json"
    path.write_text(json.dumps(body or {}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "settings": body or {}}


class CompatCreateTask(BaseModel):
    title: str
    org: str | None = None
    owner: str | None = None
    targetDept: str | None = None
    targetDepts: list[str] | None = None
    priority: str | None = "中"
    templateId: str | None = None
    params: dict | None = None


class CompatTaskAction(BaseModel):
    taskId: str
    action: str
    reason: str = ""


class CompatReviewAction(BaseModel):
    taskId: str
    action: str
    comment: str = ""


class CompatAdvanceAction(BaseModel):
    taskId: str
    comment: str = ""


async def _resolve_task_id(raw_task_id: str, db: AsyncSession) -> uuid.UUID:
    try:
        return uuid.UUID(raw_task_id)
    except ValueError:
        pass

    stmt = select(Task).where(Task.tags.contains([raw_task_id]))
    task = (await db.execute(stmt)).scalars().first()
    if not task:
        stmt2 = select(Task).where(Task.meta["legacy_id"].astext == raw_task_id)
        task = (await db.execute(stmt2)).scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task not found: {raw_task_id}")
    return task.task_id


@router.post("/api/create-task")
async def create_task_compat(
    body: CompatCreateTask,
    svc: TaskService = Depends(get_task_service),
):
    task = await svc.create_task(
        title=body.title,
        description=str((body.params or {}).get("request") or ""),
        priority=body.priority or "中",
        assignee_org=(body.targetDept or (body.targetDepts or [None])[0]),
        creator=body.owner or "compat",
        tags=[],
        meta={"legacy_payload": body.model_dump()},
    )
    return {"ok": True, "taskId": str(task.task_id), "message": "ok"}


@router.post("/api/task-action")
async def task_action_compat(
    body: CompatTaskAction,
    db: AsyncSession = Depends(get_db),
    svc: TaskService = Depends(get_task_service),
):
    task_id = await _resolve_task_id(body.taskId, db)
    action = body.action.strip().lower()
    mapping = {
        "stop": TaskState.Blocked,
        "cancel": TaskState.Cancelled,
        "resume": TaskState.ControlCenter,
    }
    target_state = mapping.get(action)
    if not target_state:
        return {"ok": False, "error": f"Unsupported action: {body.action}"}
    await svc.transition_state(task_id, target_state, "compat", body.reason)
    return {"ok": True, "message": "ok"}


@router.post("/api/review-action")
async def review_action_compat(
    body: CompatReviewAction,
    db: AsyncSession = Depends(get_db),
    svc: TaskService = Depends(get_task_service),
):
    task_id = await _resolve_task_id(body.taskId, db)
    action = body.action.strip().lower()
    target_state = TaskState.Done if action == "approve" else TaskState.ReviewCenter
    await svc.transition_state(task_id, target_state, "compat-review", body.comment)
    return {"ok": True, "message": "ok"}


@router.post("/api/advance-state")
async def advance_state_compat(
    body: CompatAdvanceAction,
    db: AsyncSession = Depends(get_db),
    svc: TaskService = Depends(get_task_service),
):
    task_id = await _resolve_task_id(body.taskId, db)
    task = await svc.get_task(task_id)
    next_map = {
        TaskState.ControlCenter: TaskState.PlanCenter,
        TaskState.PlanCenter: TaskState.ReviewCenter,
        TaskState.ReviewCenter: TaskState.Assigned,
        TaskState.Assigned: TaskState.Doing,
        TaskState.Next: TaskState.Doing,
        TaskState.Doing: TaskState.Review,
        TaskState.Review: TaskState.Done,
        TaskState.Pending: TaskState.ControlCenter,
    }
    current_state = task.state if isinstance(task.state, TaskState) else TaskState(str(task.state))
    target_state = next_map.get(current_state)
    if not target_state:
        return {"ok": False, "error": f"No forward transition for state: {current_state.value}"}
    await svc.transition_state(task_id, target_state, "compat-advance", body.comment)
    return {"ok": True, "message": "ok", "state": target_state.value}
