"""Compatibility API endpoints for historical frontend contracts."""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.task import Task, TaskState
from ..services.task_service import TaskService
from ..services.event_bus import get_event_bus

logger = logging.getLogger(__name__)

router = APIRouter()
DATA_DIR = Path(__file__).parents[4] / "data"
SESSIONS_FILE = DATA_DIR / "auth_sessions.json"
COOKIE_NAME = "orchestrator_session"
SESSION_TTL_HOURS = 24


def _read_json_file(name: str, default: Any):
    path = DATA_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json_file(name: str, data: Any):
    path = DATA_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest()


def _get_auth_cfg() -> dict:
    cfg = _read_json_file("auth.json", {})
    if not isinstance(cfg, dict):
        cfg = {}
    if "username" not in cfg:
        cfg["username"] = "admin"
    if "password_hash" not in cfg:
        salt = secrets.token_hex(16)
        cfg["salt"] = salt
        cfg["password_hash"] = _hash_password("admin", salt)
        cfg["must_change_password"] = True
        _write_json_file("auth.json", cfg)
    return cfg


def _get_sessions() -> dict:
    return _read_json_file("auth_sessions.json", {})


def _save_sessions(sessions: dict):
    _write_json_file("auth_sessions.json", sessions)


def _cleanup_expired_sessions():
    sessions = _get_sessions()
    now = datetime.now(timezone.utc).isoformat()
    expired = [k for k, v in sessions.items() if v.get("expires_at", "") < now]
    for k in expired:
        del sessions[k]
    if expired:
        _save_sessions(sessions)


def _get_current_user(request: Request) -> dict | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    sessions = _get_sessions()
    session = sessions.get(token)
    if not session:
        return None
    if session.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
        del sessions[token]
        _save_sessions(sessions)
        return None
    return session


async def get_task_service(
    db: AsyncSession = Depends(get_db),
) -> TaskService:
    bus = await get_event_bus()
    return TaskService(db, bus)


@router.get("/api/live-status")
async def live_status_compat(svc: TaskService = Depends(get_task_service)):
    """Provide `/api/live-status` for historical clients expecting the old payload.

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
async def auth_status_compat(request: Request):
    """Return auth status, checking for valid session cookie."""
    auth_cfg = _get_auth_cfg()
    username = auth_cfg.get("username", "admin")
    must_change_password = auth_cfg.get("must_change_password", False)
    user = _get_current_user(request)
    if user:
        return {
            "authenticated": True,
            "mustChangePassword": user.get("must_change_password", must_change_password),
            "currentUser": user.get("username", username),
            "username": user.get("username", username),
            "ok": True,
        }
    return {
        "authenticated": False,
        "mustChangePassword": must_change_password,
        "currentUser": "",
        "username": username,
        "ok": True,
    }


@router.post("/api/auth/login")
async def auth_login(request: Request, response: Response):
    """Authenticate user with username and password."""
    body = await request.json()
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    if not username or not password:
        return {"ok": False, "error": "用户名和密码不能为空"}
    auth_cfg = _get_auth_cfg()
    stored_username = auth_cfg.get("username", "admin")
    if username != stored_username:
        return {"ok": False, "error": "用户名或密码错误"}
    salt = auth_cfg.get("salt", "")
    expected_hash = auth_cfg.get("password_hash", "")
    if _hash_password(password, salt) != expected_hash:
        return {"ok": False, "error": "用户名或密码错误"}
    token = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc).timestamp() + SESSION_TTL_HOURS * 3600
    expires_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()
    sessions = _get_sessions()
    _cleanup_expired_sessions()
    sessions[token] = {
        "username": username,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_iso,
        "must_change_password": auth_cfg.get("must_change_password", False),
    }
    _save_sessions(sessions)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL_HOURS * 3600,
        path="/",
    )
    return {
        "ok": True,
        "token": token,
        "username": username,
        "mustChangePassword": auth_cfg.get("must_change_password", False),
    }


@router.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response):
    """Logout user by invalidating session."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        sessions = _get_sessions()
        sessions.pop(token, None)
        _save_sessions(sessions)
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True, "message": "已退出登录"}


@router.post("/api/auth/first-change")
async def auth_first_change(request: Request, response: Response):
    """Force first password change after initial login."""
    body = await request.json()
    current_password = body.get("currentPassword", "").strip()
    new_password = body.get("newPassword", "").strip()
    new_username = body.get("newUsername", "").strip() or None
    user = _get_current_user(request)
    if not user:
        return {"ok": False, "error": "未登录"}
    auth_cfg = _get_auth_cfg()
    salt = auth_cfg.get("salt", "")
    if _hash_password(current_password, salt) != auth_cfg.get("password_hash", ""):
        return {"ok": False, "error": "当前密码错误"}
    if len(new_password) < 6:
        return {"ok": False, "error": "新密码至少需要6位"}
    new_salt = secrets.token_hex(16)
    auth_cfg["salt"] = new_salt
    auth_cfg["password_hash"] = _hash_password(new_password, new_salt)
    auth_cfg["must_change_password"] = False
    if new_username:
        auth_cfg["username"] = new_username
    _write_json_file("auth.json", auth_cfg)
    username = auth_cfg["username"]
    sessions = _get_sessions()
    for session in sessions.values():
        session["must_change_password"] = False
        session["username"] = username
    _save_sessions(sessions)
    return {
        "ok": True,
        "username": username,
        "mustChangePassword": False,
        "message": "密码已更新",
    }


@router.post("/api/auth/change-password")
async def auth_change_password(request: Request):
    """Change password for logged-in user."""
    body = await request.json()
    current_password = body.get("currentPassword", "").strip()
    new_password = body.get("newPassword", "").strip()
    user = _get_current_user(request)
    if not user:
        return {"ok": False, "error": "未登录"}
    auth_cfg = _get_auth_cfg()
    salt = auth_cfg.get("salt", "")
    if _hash_password(current_password, salt) != auth_cfg.get("password_hash", ""):
        return {"ok": False, "error": "当前密码错误"}
    if len(new_password) < 6:
        return {"ok": False, "error": "新密码至少需要6位"}
    new_salt = secrets.token_hex(16)
    auth_cfg["salt"] = new_salt
    auth_cfg["password_hash"] = _hash_password(new_password, new_salt)
    _write_json_file("auth.json", auth_cfg)
    return {"ok": True, "message": "密码已更新"}


@router.post("/api/auth/change-username")
async def auth_change_username(request: Request):
    """Change username for logged-in user."""
    body = await request.json()
    current_password = body.get("currentPassword", "").strip()
    new_username = body.get("newUsername", "").strip()
    user = _get_current_user(request)
    if not user:
        return {"ok": False, "error": "未登录"}
    if not new_username:
        return {"ok": False, "error": "新用户名不能为空"}
    auth_cfg = _get_auth_cfg()
    salt = auth_cfg.get("salt", "")
    if _hash_password(current_password, salt) != auth_cfg.get("password_hash", ""):
        return {"ok": False, "error": "当前密码错误"}
    auth_cfg["username"] = new_username
    _write_json_file("auth.json", auth_cfg)
    return {"ok": True, "username": new_username, "message": "用户名已更新"}


@router.get("/api/agent-config")
async def agent_config_compat():
    """Provide agent config, discovering skills from openclaw workspaces."""
    cfg_path = Path(__file__).parents[4] / "data" / "agent_config.json"
    payload: dict[str, Any] = {"agents": [], "knownModels": [], "dispatchChannel": "openclaw", "ok": True}
    
    if cfg_path.exists():
        try:
            payload = json.loads(cfg_path.read_text(encoding="utf-8"))
            payload["ok"] = True
        except (json.JSONDecodeError, OSError):
            pass
    
    # 从 openclaw workspace 发现 skills
    _inject_openclaw_skills(payload)
    
    return payload


def _inject_openclaw_skills(payload: dict[str, Any]) -> None:
    """扫描 openclaw workspace 目录，将发现的 skill 注入 agent_config。"""
    openclaw_home = Path.home() / ".openclaw"
    openclaw_cfg_path = openclaw_home / "openclaw.json"
    if not openclaw_cfg_path.exists():
        return
    
    try:
        oclaw_cfg = json.loads(openclaw_cfg_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    
    agent_list = oclaw_cfg.get("agents", {}).get("list", [])
    if not agent_list:
        return
    
    # 构建 agent_id → workspace 映射
    agent_workspace_map: dict[str, Path] = {}
    for ag in agent_list:
        aid = ag.get("id", "")
        ws = ag.get("workspace", "")
        if aid and ws:
            agent_workspace_map[aid] = Path(ws)
    
    # 先从 main workspace 读取全局共享 skill
    global_skills: list[dict[str, Any]] = []
    main_ws = agent_workspace_map.get("main")
    if main_ws:
        skills_dir = main_ws / "skills"
        if skills_dir.is_dir():
            global_skills = _discover_skills_in_dir(skills_dir)
    
    existing_agents = {a.get("id", ""): a for a in payload.get("agents", [])}
    
    # 排除 main，其余 agent 继承全局 skill
    for aid, ws_path in agent_workspace_map.items():
        if aid == "main":
            continue
        
        # 收集此 agent 自己拥有的本地 skill（不含全局共享）
        agent_skills: list[dict[str, Any]] = []
        own_skills_dir = ws_path / "skills"
        if own_skills_dir.is_dir():
            agent_skills.extend(_discover_skills_in_dir(own_skills_dir))
        
        if agent_skills:
            if aid in existing_agents:
                existing_agents[aid]["skills"] = agent_skills
            else:
                existing_agents[aid] = {
                    "id": aid,
                    "label": aid.replace("_", " ").title(),
                    "skills": agent_skills,
                }
    
    # 全局共享 skill 以 "global" 伪 agent 置顶
    if global_skills:
        final_agents = []
        final_agents.append({
            "id": "global",
            "label": "全局共享 (Global Shared)",
            "skills": global_skills,
        })
        for ag in existing_agents.values():
            if ag.get("id") != "main":
                final_agents.append(ag)
        payload["agents"] = final_agents
    else:
        payload["agents"] = [a for a in existing_agents.values() if a.get("id") != "main"]


def _discover_skills_in_dir(skills_dir: Path) -> list[dict[str, Any]]:
    """扫描指定目录，返回 skill 列表。"""
    skills: list[dict[str, Any]] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        
        skill_name = skill_dir.name
        description = ""
        try:
            content = skill_md.read_text(encoding="utf-8")
            if content.startswith("---"):
                end_idx = content.find("---", 3)
                if end_idx > 0:
                    frontmatter = content[3:end_idx]
                    for line in frontmatter.split("\n"):
                        if line.startswith("description:") and not description:
                            desc_val = line.split(":", 1)[1].strip()
                            if desc_val and desc_val != "|":
                                description = desc_val
                            elif desc_val == "|":
                                pass
                    if not description:
                        for line in content[end_idx + 3:].split("\n"):
                            stripped = line.strip()
                            if stripped and not stripped.startswith("#"):
                                description = stripped[:120]
                                break
            else:
                for line in content.split("\n"):
                    if line.startswith("description:"):
                        description = line.split(":", 1)[1].strip()
                        break
        except (OSError, UnicodeDecodeError):
            pass
        
        skills.append({
            "name": skill_name,
            "description": description or skill_name,
            "path": str(skill_md),
        })
    return skills


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
    source: str | None = None


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
    source_val = body.source or (body.params or {}).get("source") or "compat"
    source_map = {"sys": "SYS", "user": "USER", "compat": "COMPAT"}
    creator = source_map.get(str(source_val).lower(), "COMPAT")
    task = await svc.create_task(
        title=body.title,
        description=str((body.params or {}).get("request") or ""),
        priority=body.priority or "中",
        assignee_org=(body.targetDept or (body.targetDepts or [None])[0]),
        creator=body.owner or creator,
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


@router.get("/api/global-agent-busy")
async def global_agent_busy(db: AsyncSession = Depends(get_db)):
    """返回 Agent 忙碌状态，基于当前活跃任务的实际分配情况。"""
    from datetime import timezone as dt_timezone
    
    try:
        result = await db.execute(
            select(Task).where(
                ~Task.state.in_([TaskState.Done, TaskState.Cancelled])
            )
        )
        active_tasks = result.scalars().all()
        logger.info(f"global_agent_busy: found {len(active_tasks)} active tasks")
        
        busy_entries: list[dict[str, Any]] = []
        sessions: list[dict[str, Any]] = []
        task_ids: list[str] = []
        
        for task in active_tasks:
            agent_id = task.assignee_org or task.org or ""
            task_ids.append(str(task.task_id))
            if agent_id:
                busy_entries.append({
                    "agent_id": agent_id,
                    "task_id": str(task.task_id),
                    "state": task.state.value if hasattr(task.state, 'value') else str(task.state),
                    "title": task.title or "",
                    "updated_at": task.updated_at.isoformat() if task.updated_at else "",
                })
        
        # 检查直接搜索状态
        with _search_lock:
            if _search_state.get("status") == "searching":
                busy_entries.append({
                    "agent_id": "search_specialist",
                    "task_id": "direct-search",
                    "state": "searching",
                    "title": _search_state.get("query", ""),
                    "updated_at": datetime.fromtimestamp(_search_state.get("started_at", 0), tz=timezone.utc).isoformat(),
                })
        
        # 检查活跃的协作会议（仅当前发言者标记为忙碌）
        collab_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
        if collab_dir.is_dir():
            for sf in collab_dir.glob("*.json"):
                try:
                    s = json.loads(sf.read_text())
                    stage = s.get("stage", "")
                    if stage in ("completed", "concluded"):
                        continue
                    # 找出当前发言者
                    speakers = s.get("speaker_queue", [])
                    idx = s.get("current_speaker_index", 0)
                    if speakers and idx < len(speakers):
                        current = speakers[idx]
                        if not any(b["agent_id"] == current for b in busy_entries):
                            busy_entries.append({
                                "agent_id": current,
                                "task_id": s.get("session_id", ""),
                                "state": "meeting",
                                "title": f"会议: {s.get('topic', '')}",
                                "updated_at": s.get("created_at", ""),
                            })
                    sessions.append({
                        "session_id": s.get("session_id", ""),
                        "topic": s.get("topic", ""),
                        "participants": s.get("agent_ids", []),
                    })
                except (json.JSONDecodeError, OSError):
                    pass
        
        return {
            "ok": True,
            "busy": busy_entries,
            "sessions": sessions,
            "tasks": task_ids,
            "updated_at": int(datetime.now(timezone.utc).timestamp()),
        }
    except Exception as e:
        return {
            "ok": True,
            "busy": [],
            "sessions": [],
            "tasks": [],
            "updated_at": int(datetime.now(timezone.utc).timestamp()),
            "error": str(e),
        }


@router.get("/api/collab-discuss/agent-busy")
async def collab_agent_busy():
    return {
        "ok": True,
        "busy": [],
        "sessions": [],
        "tasks": [],
        "updated_at": int(datetime.now(timezone.utc).timestamp()),
    }


@router.get("/api/collab-discuss/fate")
async def collab_fate():
    return {"ok": True, "event": "none"}


@router.get("/api/task-activity/{task_id}")
async def task_activity(task_id: str, db: AsyncSession = Depends(get_db)):
    """返回任务活动日志和进度汇总。"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return {"ok": False, "error": "Invalid task ID", "activity": [], "todosSummary": {"total": 0, "completed": 0, "inProgress": 0, "notStarted": 0, "percent": 0}}

    task = await db.get(Task, task_uuid)
    if not task:
        return {"ok": False, "error": "Task not found", "activity": [], "todosSummary": {"total": 0, "completed": 0, "inProgress": 0, "notStarted": 0, "percent": 0}}

    # 构建活动日志
    activity = []
    flow_log = task.flow_log or []
    for entry in flow_log:
        activity.append({
            "kind": "flow",
            "at": entry.get("at") or entry.get("ts", ""),
            "from": entry.get("from", ""),
            "to": entry.get("to", ""),
            "agent": entry.get("agent", ""),
            "remark": entry.get("remark", ""),
        })

    progress_log = task.progress_log or []
    for entry in progress_log:
        activity.append({
            "kind": "progress",
            "at": entry.get("at", ""),
            "agent": entry.get("agent", ""),
            "text": entry.get("text", ""),
            "summary": entry.get("summary", ""),
        })

    # 按时间排序
    activity.sort(key=lambda x: x.get("at", ""), reverse=True)

    # 构建 TODO 汇总
    todos = task.todos or []
    total = len(todos)
    completed = sum(1 for t in todos if t.get("status") == "completed")
    in_progress = sum(1 for t in todos if t.get("status") == "in-progress")
    not_started = sum(1 for t in todos if t.get("status") == "not-started")
    percent = round((completed / total * 100) if total > 0 else 0)

    return {
        "ok": True,
        "activity": activity,
        "relatedAgents": list(set(e.get("agent", "") for e in activity if e.get("agent"))),
        "phaseDurations": [],
        "totalDuration": "0s",
        "todosSummary": {
            "total": total,
            "completed": completed,
            "inProgress": in_progress,
            "notStarted": not_started,
            "percent": percent,
        },
    }


@router.get("/api/scheduler-state/{task_id}")
async def scheduler_state(task_id: str, db: AsyncSession = Depends(get_db)):
    """返回任务调度器状态和停滞时长。"""
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        return {"ok": False, "error": "Invalid task ID", "scheduler": {}, "stalledSec": 0}

    task = await db.get(Task, task_uuid)
    if not task:
        return {"ok": False, "error": "Task not found", "scheduler": {}, "stalledSec": 0}

    meta = task.meta or {}
    scheduler = meta.get("scheduler", {})
    updated_at = task.updated_at
    if updated_at and updated_at.tzinfo is None:
        from datetime import timezone
        updated_at = updated_at.replace(tzinfo=timezone.utc)

    stalled_sec = 0
    if updated_at:
        from datetime import datetime, timezone
        stalled_sec = int((datetime.now(timezone.utc) - updated_at).total_seconds())

    return {
        "ok": True,
        "scheduler": scheduler,
        "stalledSec": stalled_sec,
    }


@router.get("/api/agent-activity/{agent_id}")
async def agent_activity(agent_id: str):
    return {"ok": True, "agentId": agent_id, "activity": []}


@router.get("/api/skill-content/{agent_id}/{skill_name}")
async def skill_content(agent_id: str, skill_name: str):
    return {"ok": False, "error": "Skill not found"}


@router.get("/api/remote-skills-list")
async def remote_skills_list():
    return {"ok": True, "remoteSkills": [], "count": 0}


@router.post("/api/add-remote-skill")
async def add_remote_skill(body: dict):
    return {"ok": False, "error": "Remote skills not configured"}


@router.post("/api/update-remote-skill")
async def update_remote_skill(body: dict):
    return {"ok": True}


@router.post("/api/remove-remote-skill")
async def remove_remote_skill(body: dict):
    return {"ok": True}


@router.post("/api/search-brief/refresh")
async def refresh_search_brief():
    return {"ok": True}


# ── 搜索状态 ──
import threading

_search_lock = threading.Lock()
_search_state: dict = {
    "query": "",
    "status": "idle",  # idle | searching | done | error
    "results": "",
    "error": "",
    "started_at": 0.0,
}


def _run_search(query: str, topic_scope: str, keywords: str, freshness_days: str, search_depth: str, result_limit: str):
    """在后台线程中执行搜索。"""
    import subprocess
    from ..config import get_settings

    settings = get_settings()

    prompt = f"""请执行以下搜索任务：

搜索问题：{query}
""" + (f"主题范围：{topic_scope}\n" if topic_scope else "") + f"""关键词：{keywords}
时间范围：最近 {freshness_days} 天
搜索深度：{search_depth}
结果数量：最多 {result_limit} 条

## 使用工具优先级
1. 如果你的工作区安装了专用数据 skill（如天气、股票、汇率、百科等），优先用它们获取精确数据
2. 再用搜索 API 补充信息
3. 如果搜索 API 返回的结果相关度不高，主动换用其他关键词、英文搜索、或直接访问已知来源网站

## 输出格式

### 1. [标题]
- 来源：[网站/来源]
- 摘要：[内容摘要]
- 链接：[URL]
- 时间：[发布时间]
- 数据来源：[skill/搜索API/直接访问]

（按相关性排序，最多返回指定数量的结果）

## 搜索总结
[简要总结搜索发现的关键信息，说明使用了哪些工具和方法]
"""

    try:
        proc = subprocess.run(
            [settings.openclaw_bin, "agent", "--agent", "search_specialist", "-m", prompt],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=settings.openclaw_project_dir or None,
        )

        with _search_lock:
            if proc.returncode == 0:
                output = proc.stdout.strip()
                _search_state["status"] = "done"
                _search_state["results"] = output
                _search_state["error"] = ""
            else:
                _search_state["status"] = "error"
                _search_state["results"] = ""
                _search_state["error"] = f"搜索执行失败: {proc.stderr[:200]}"
    except subprocess.TimeoutExpired:
        with _search_lock:
            _search_state["status"] = "error"
            _search_state["results"] = ""
            _search_state["error"] = "搜索超时，请稍后重试"
    except Exception as e:
        with _search_lock:
            _search_state["status"] = "error"
            _search_state["results"] = ""
            _search_state["error"] = f"搜索执行出错: {str(e)}"


@router.post("/api/agent-search")
async def agent_search(body: dict):
    """启动搜索（异步后台执行），立即返回搜索 ID。"""
    query = body.get("query", "").strip()
    if not query:
        return {"ok": False, "error": "搜索查询不能为空"}

    topic_scope = body.get("topic_scope", "全部")
    keywords = body.get("keywords", "")
    freshness_days = body.get("freshness_days", "30")
    search_depth = body.get("search_depth", "standard")
    result_limit = body.get("result_limit", "10")

    with _search_lock:
        if _search_state["status"] == "searching":
            return {"ok": False, "error": "当前有搜索正在进行中，请稍后重试"}
        _search_state["query"] = query
        _search_state["status"] = "searching"
        _search_state["results"] = ""
        _search_state["error"] = ""
        _search_state["started_at"] = time.time()

    thread = threading.Thread(
        target=_run_search,
        args=(query, topic_scope, keywords, str(freshness_days), search_depth, str(result_limit)),
        daemon=True,
    )
    thread.start()

    return {"ok": True, "status": "searching", "query": query}


@router.get("/api/agent-search")
async def agent_search_status():
    """获取当前搜索状态与结果。"""
    with _search_lock:
        result = dict(_search_state)
        if result["status"] == "done":
            output = result["results"]
            result["resultCount"] = output.count("## ") - 2 if "## 搜索总结" in output else 0
        else:
            result["resultCount"] = 0
        return {"ok": True, **result}


@router.post("/api/set-model")
async def set_model(body: dict):
    return {"ok": True, "message": "Model change queued"}


@router.post("/api/set-dispatch-channel")
async def set_dispatch_channel(body: dict):
    return {"ok": True}


@router.post("/api/agent-wake")
async def agent_wake(body: dict):
    return {"ok": True}


@router.post("/api/agent-command")
async def agent_command(body: dict):
    return {"ok": True}


@router.post("/api/archive-task")
async def archive_task(body: dict):
    return {"ok": True}


@router.post("/api/scheduler-scan")
async def scheduler_scan(body: dict):
    return {"ok": True, "count": 0, "actions": []}


@router.post("/api/scheduler-retry")
async def scheduler_retry(body: dict):
    return {"ok": True}


@router.post("/api/scheduler-escalate")
async def scheduler_escalate(body: dict):
    return {"ok": True}


@router.post("/api/scheduler-rollback")
async def scheduler_rollback(body: dict):
    return {"ok": True}


@router.post("/api/scheduler-config")
async def scheduler_config(body: dict):
    return {"ok": True}


@router.post("/api/add-skill")
async def add_skill(body: dict):
    return {"ok": True}


@router.post("/api/task-append-message")
async def task_append_message(body: dict):
    return {"ok": True}


@router.post("/api/collab-discuss/start")
async def collab_discuss_start(body: dict):
    """启动一次多 Agent 协作讨论（异步，立即返回）。"""
    import subprocess
    from ..config import get_settings
    
    settings = get_settings()
    topic = body.get("topic", "")
    agent_ids = body.get("agentIds", body.get("agent_ids", body.get("agents", [])))
    intent = body.get("intent", body.get("preferredMode", "auto"))
    moderator_id = body.get("moderatorId", body.get("moderator_id", agent_ids[0] if agent_ids else "control_center"))
    select_all = body.get("selectAll", body.get("select_all", True))
    
    if not topic or len(agent_ids) < 2:
        return {"ok": False, "error": "Need topic and at least 2 agents"}
    
    session_id = f"collab-{uuid.uuid4().hex[:12]}"
    
    speakers = [aid for aid in agent_ids if aid != moderator_id]
    
    # 预创建 session 文件（preparing 状态）
    session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file = session_dir / f"{session_id}.json"
    
    session = {
        "session_id": session_id,
        "topic": topic,
        "agent_ids": agent_ids,
        "moderator_id": moderator_id,
        "moderator_name": moderator_id,
        "mode": intent,
        "stage": "preparing",
        "round": 0,
        "messages": [],
        "speaker_queue": speakers,
        "current_speaker_index": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    session_file.write_text(json.dumps(session, ensure_ascii=False, default=str))
    
    # 后台线程执行开场
    def _run_opening():
        try:
            if intent == "auto":
                prompt = (
                    f"你是{moderator_id}，正在发起一场关于「{topic}」的讨论。\n"
                    f"参与者：{', '.join(agent_ids)}。\n\n"
                    f"请自然开场。如果是正式议题，像主持人一样组织发言；如果是闲聊话题，用轻松语气。回复控制在200字以内。"
                )
            elif intent == "chat":
                prompt = f"现在是{', '.join(agent_ids)}之间的群聊。话题：{topic}。你是{moderator_id}，用自然的、聊天的语气发起对话。回复控制在200字以内。"
            else:
                prompt = f"[协作讨论] 主题：{topic}。参与方：{', '.join(agent_ids)}。你是主持人{moderator_id}，请做开场发言，说明讨论目标，然后邀请{', '.join(speakers) if speakers else '其他参与者'}发言。回复控制在200字以内。"
            
            proc = subprocess.run(
                [settings.openclaw_bin, "agent", "--agent", moderator_id, "-m", prompt, "--json"],
                capture_output=True, text=True, timeout=120,
                cwd=settings.openclaw_project_dir or None,
            )
            
            fallback = f"大家好，今天我们来讨论：{topic}。请各位发表意见。" if intent in ("auto", "meeting") else f"大家好，今天聊聊：{topic}。"
            
            msg_text = f"大家好，今天我们讨论：{topic}。有请 {speakers[0] if speakers else '下一位'} 先发言。"
            if proc.returncode == 0 and proc.stdout.strip():
                try:
                    result = json.loads(proc.stdout.strip())
                    payloads = result.get("result", {}).get("payloads", [])
                    if payloads and payloads[0].get("text"):
                        fallback = payloads[0]["text"]
                except json.JSONDecodeError:
                    fallback = proc.stdout.strip()[:500]
            
            if session_file.exists():
                s = json.loads(session_file.read_text())
                s["messages"] = [{
                    "type": "agent",
                    "agent_id": moderator_id,
                    "agent_name": moderator_id,
                    "content": fallback,
                    "emotion": "neutral",
                }]
                s["stage"] = "discussion"
                s["round"] = 1
                session_file.write_text(json.dumps(s, ensure_ascii=False, default=str))
        except Exception:
            if session_file.exists():
                s = json.loads(session_file.read_text())
                s["messages"] = [{
                    "type": "agent",
                    "agent_id": moderator_id,
                    "agent_name": moderator_id,
                    "content": fallback,
                    "emotion": "neutral",
                }]
                s["stage"] = "discussion"
                s["round"] = 1
                session_file.write_text(json.dumps(s, ensure_ascii=False, default=str))
    
    thread = threading.Thread(target=_run_opening, daemon=True)
    thread.start()
    
    return {
        "ok": True,
        "session_id": session_id,
        "topic": topic,
        "agents": agent_ids,
        "moderator_id": moderator_id,
        "moderator_name": moderator_id,
        "mode": intent,
        "stage": "preparing",
        "round": 0,
        "phase": "preparing",
        "messages": [],
        "speaker_queue": speakers,
        "new_messages": [],
    }


@router.post("/api/collab-discuss/advance")
async def collab_discuss_advance(body: dict, db: AsyncSession = Depends(get_db)):
    """推进讨论（异步，立即返回）。"""
    import subprocess
    from ..config import get_settings
    
    settings = get_settings()
    session_id = body.get("session_id", body.get("sessionId", ""))
    user_message = body.get("userMessage", body.get("user_message", ""))
    constraint = body.get("constraint", "")
    intent = body.get("intent", "auto")
    speaker_ids = body.get("speakerIds", body.get("speaker_ids", []))
    
    if not session_id:
        return {"ok": False, "error": "Session ID required"}
    
    session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
    session_file = session_dir / f"{session_id}.json"
    
    if not session_file.exists():
        return {"ok": False, "error": "Session not found"}
    
    session = json.loads(session_file.read_text())
    
    speakers = session.get("speaker_queue", [])
    if not speakers:
        return {"ok": False, "error": "No speakers in queue"}
    
    idx = session.get("current_speaker_index", 0)
    
    # 查询忙碌的 agent（有活跃任务）
    result = await db.execute(
        select(Task.assignee_org, Task.org).where(
            ~Task.state.in_([TaskState.Done, TaskState.Cancelled])
        )
    )
    busy_agents = set()
    for row in result.all():
        if row[0]:
            busy_agents.add(row[0])
        if row[1]:
            busy_agents.add(row[1])
    
    # 跳过忙碌的 speaker，找第一个空闲的
    original_idx = idx
    found = False
    for i in range(len(speakers)):
        check_idx = (idx + i) % len(speakers)
        candidate = speaker_ids[0] if speaker_ids else speakers[check_idx]
        if candidate not in busy_agents:
            idx = check_idx
            current_speaker = candidate
            found = True
            break
    
    if not found:
        return {"ok": False, "error": "所有参与成员均忙碌中，请稍后再试"}
    
    # 如果跳过了，备注说明
    skip_note = ""
    if idx != original_idx:
        skipped = speakers[original_idx] if original_idx < len(speakers) else "unknown"
        skip_note = f"（{skipped} 正忙，已跳过）"
    
    # 标记为 thinking 状态
    session["stage"] = "thinking"
    session_file.write_text(json.dumps(session, ensure_ascii=False, default=str))
    
    # 后台线程执行发言
    def _run_advance():
        try:
            recent_msgs = session.get("messages", [])[-8:]
            context = "\n".join(
                f"[{m.get('agent_name', m.get('agent_id', '?'))}]: {m.get('content', '')}"
                for m in recent_msgs
            )
            
            mode = session.get("mode", "auto")
            topic = session.get("topic", "")
            moderator_id_s = session.get("moderator_id", "")
            
            if mode == "auto":
                prompt = (
                    f"你是{current_speaker}，正在参加一场关于「{topic}」的讨论。\n\n"
                    f"参与者：{', '.join(session.get('agent_ids', []))}。主持人是{moderator_id_s}。\n\n"
                    f"最近发言：\n{context}\n"
                )
                if user_message:
                    prompt += f"\n用户消息：{user_message}\n"
                    prompt += "用户可能在要求你们做某事（比如创建任务、制定计划等），也可能是闲聊。请根据用户意图和上下文灵活回应：\n"
                    prompt += "- 如果是闲聊，用自然的、聊天的语气回复\n"
                    prompt += "- 如果是正式任务要求，用结构化的方式回应，必要时组织讨论并形成结论\n"
                else:
                    prompt += "\n请自然地参与讨论。可以用正式或聊天的语气，根据上下文灵活切换。"
                prompt += "\n回复控制在200字以内。"
            elif mode == "chat":
                prompt = f"[群聊] 你们是{', '.join(session.get('agent_ids', []))}，在聊{topic}。你是{current_speaker}。\n\n最近聊天记录：\n{context}"
                if user_message:
                    prompt += f"\n用户说：{user_message}"
                prompt += "\n\n说你想说的话。用自然的聊天语气。回复控制在200字以内。"
            else:  # meeting
                prompt = f"[协作讨论] 主题：{topic}。你是{current_speaker}。\n\n最近发言：\n{context}"
                if user_message:
                    prompt += f"\n用户指示：{user_message}"
                if constraint:
                    prompt += f"\n要求：{constraint}"
                prompt += "\n\n请发表你的意见。回复控制在200字以内。"
            
            proc = subprocess.run(
                [settings.openclaw_bin, "agent", "--agent", current_speaker, "-m", prompt, "--json"],
                capture_output=True, text=True, timeout=120,
                cwd=settings.openclaw_project_dir or None,
            )
            
            msg_text = f"[{current_speaker}] 收到，思考中..."
            if proc.returncode == 0 and proc.stdout.strip():
                try:
                    result = json.loads(proc.stdout.strip())
                    payloads = result.get("result", {}).get("payloads", [])
                    if payloads and payloads[0].get("text"):
                        msg_text = payloads[0]["text"]
                except json.JSONDecodeError:
                    msg_text = proc.stdout.strip()[:500]
            
            if session_file.exists():
                s = json.loads(session_file.read_text())
                new_msg = {
                    "type": "agent",
                    "agent_id": current_speaker,
                    "agent_name": current_speaker,
                    "content": msg_text,
                    "emotion": "neutral",
                }
                s["messages"] = (s.get("messages", []) + [new_msg])[-20:]
                s["round"] = s.get("round", 0) + 1
                s["current_speaker_index"] = (s.get("current_speaker_index", 0) + 1) % max(len(s.get("speaker_queue", [])), 1)
                s["stage"] = "discussion"
                session_file.write_text(json.dumps(s, ensure_ascii=False, default=str))
        except Exception:
            if session_file.exists():
                s = json.loads(session_file.read_text())
                s["stage"] = "discussion"
                session_file.write_text(json.dumps(s, ensure_ascii=False, default=str))
    
    thread = threading.Thread(target=_run_advance, daemon=True)
    thread.start()
    
    return {
        "ok": True,
        "session_id": session_id,
        "stage": "thinking",
        "round": session.get("round", 0),
        "new_messages": [],
        "speaker_queue": speakers,
    }


@router.get("/api/collab-discuss/run-status/{session_id}")
async def collab_discuss_run_status(session_id: str):
    """获取协作讨论的当前状态。"""
    session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
    session_file = session_dir / f"{session_id}.json"
    
    if not session_file.exists():
        # 尝试旧格式
        old_file = Path(__file__).parents[4] / "data" / "collab_sessions" / f"{session_id}.json"
        if not old_file.exists():
            return {"ok": False, "error": "Session not found"}
    
    session = json.loads(session_file.read_text())
    return {
        "ok": True,
        "session_id": session_id,
        "stage": session.get("stage", "discussion"),
        "round": session.get("round", 0),
        "messages": session.get("messages", []),
        "speaker_queue": session.get("speaker_queue", []),
    }


@router.post("/api/collab-discuss/pause")
async def collab_discuss_pause(body: dict):
    session_id = body.get("session_id", body.get("sessionId", ""))
    if session_id:
        session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
        session_file = session_dir / f"{session_id}.json"
        if session_file.exists():
            session = json.loads(session_file.read_text())
            session["run_state"] = "paused"
            session_file.write_text(json.dumps(session, ensure_ascii=False, default=str))
    return {"ok": True, "run_state": "paused", "session_id": session_id}


@router.post("/api/collab-discuss/resume")
async def collab_discuss_resume(body: dict):
    session_id = body.get("session_id", body.get("sessionId", ""))
    if session_id:
        session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
        session_file = session_dir / f"{session_id}.json"
        if session_file.exists():
            session = json.loads(session_file.read_text())
            session["run_state"] = "running"
            session_file.write_text(json.dumps(session, ensure_ascii=False, default=str))
    return {"ok": True, "run_state": "running", "session_id": session_id}


def _collect_collab_discuss_agent_ids(session_id: str) -> tuple[list[str], Path | None]:
    if not session_id:
        return [], None
    session_dir = Path(__file__).parents[4] / "data" / "collab_sessions"
    session_file = session_dir / f"{session_id}.json"
    if not session_file.exists():
        return [], session_file
    try:
        session = json.loads(session_file.read_text())
    except (json.JSONDecodeError, OSError):
        return [], session_file
    agent_ids = session.get("agent_ids", []) + [session.get("moderator_id", "")]
    agent_ids = list(dict.fromkeys(aid for aid in agent_ids if aid))
    return agent_ids, session_file


def _clear_collab_sessions_async(agent_ids: list[str], message: str) -> None:
    if not agent_ids:
        return

    def _worker() -> None:
        import subprocess
        from ..config import get_settings

        settings = get_settings()
        for aid in agent_ids:
            try:
                subprocess.run(
                    [settings.openclaw_bin, "agent", "--agent", aid, "-m", message, "--json"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=settings.openclaw_project_dir or None,
                )
            except Exception:
                logger.exception("清理协作讨论会话失败: %s", aid)

    threading.Thread(target=_worker, daemon=True).start()


@router.post("/api/collab-discuss/conclude")
async def collab_discuss_conclude(body: dict):
    session_id = body.get("session_id", body.get("sessionId", ""))
    agent_ids, session_file = _collect_collab_discuss_agent_ids(session_id)

    if session_file and session_file.exists():
        try:
            session = json.loads(session_file.read_text())
            session["stage"] = "completed"
            session_file.write_text(json.dumps(session, ensure_ascii=False, default=str))
        except (json.JSONDecodeError, OSError):
            logger.exception("写入协作讨论完成状态失败: %s", session_id)

    _clear_collab_sessions_async(
        agent_ids,
        "/new 会议已结束。除非用户明确要求，不要将本次会议的任何内容写入MEMORY.md或memory目录。",
    )

    return {
        "ok": True,
        "summary": "讨论已结束",
        "stage": "completed",
        "cleared_agents": agent_ids,
        "clear_mode": "background",
    }


@router.post("/api/collab-discuss/destroy")
async def collab_discuss_destroy(body: dict):
    session_id = body.get("session_id", body.get("sessionId", ""))
    agent_ids, session_file = _collect_collab_discuss_agent_ids(session_id)

    if session_file and session_file.exists():
        try:
            session_file.unlink()
        except OSError:
            logger.exception("删除协作讨论会话文件失败: %s", session_id)

    _clear_collab_sessions_async(
        agent_ids,
        "/new 会议已结束。除非用户明确要求，不要将本次会议的任何内容写入MEMORY.md或memory目录。",
    )

    return {"ok": True, "cleared_agents": agent_ids, "clear_mode": "background"}


@router.get("/api/memory-files")
async def memory_files():
    """列出 OpenClaw 系统中的全局和 Agent 记忆文件。"""
    import pathlib as _pl
    openclaw_home = _pl.Path.home() / ".openclaw"
    
    files: list[dict[str, Any]] = []
    
    shared_ws = openclaw_home / "workspace"
    if shared_ws.is_dir():
        mem_dir = shared_ws / "memory"
        if mem_dir.is_dir():
            _scan_mem_dir(files, mem_dir, "共享记忆", "shared_memory")
        # 共享工作区根目录的 MEMORY.md
        for name in ["MEMORY.md"]:
            f = shared_ws / name
            if f.is_file():
                _scan_mem_dir(files, shared_ws, "共享工作区", "shared", filter_names=[name])
    
    main_ws = openclaw_home / "workspace-main"
    if main_ws.is_dir():
        mem_dir = main_ws / "memory"
        if mem_dir.is_dir():
            _scan_mem_dir(files, mem_dir, "主 Agent 记忆", "main_memory")
        for name in ["MEMORY.md"]:
            f = main_ws / name
            if f.is_file():
                _scan_mem_dir(files, main_ws, "主 Agent", "main", filter_names=[name])
    
    for ws_dir in sorted(openclaw_home.glob("workspace-*")):
        aid = ws_dir.name.replace("workspace-", "")
        if aid == "main":
            continue
        mem_dir = ws_dir / "memory"
        if mem_dir.is_dir():
            _scan_mem_dir(files, mem_dir, f"{aid}记忆", "agent_memory")
        for name in ["MEMORY.md"]:
            f = ws_dir / name
            if f.is_file():
                _scan_mem_dir(files, ws_dir, aid, "agent", filter_names=[name])
    
    return {"ok": True, "files": files}


def _scan_mem_dir(result: list, directory: Path, label: str, kind: str, filter_names: list[str] | None = None):
    for f in sorted(directory.glob("*.md")):
        if f.name.startswith("."):
            continue
        if filter_names and f.name not in filter_names:
            continue
        try:
            stat = f.stat()
            size = stat.st_size
            updated = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
        except OSError:
            size = 0
            updated = ""
        result.append({
            "path": str(f.relative_to(Path.home() / ".openclaw")),
            "name": f.name,
            "label": label,
            "kind": kind,
            "size": size,
            "updated_at": updated,
        })


@router.get("/api/memory-file")
async def memory_file(path: str = ""):
    """读取指定 OpenClaw 工作区记忆文件内容。"""
    import pathlib as _pl
    openclaw_home = _pl.Path.home() / ".openclaw"
    
    if not path:
        return {"ok": False, "error": "path required"}
    
    full_path = (openclaw_home / path).resolve()
    if not str(full_path).startswith(str(openclaw_home.resolve())):
        return {"ok": False, "error": "路径不在允许范围内"}
    
    if not full_path.is_file():
        return {"ok": False, "error": "文件不存在"}
    
    try:
        content = full_path.read_text(encoding="utf-8")
        return {"ok": True, "path": path, "content": content}
    except Exception as e:
        return {"ok": False, "error": str(e)}

