"""Tasks API — 任务的 CRUD 和状态流转。"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.task import TaskState
from ..services.task_workspace import (
    create_task_workspace_archive,
    list_task_workspace_entries,
    read_task_workspace_text,
    resolve_task_workspace_download_path,
    write_task_workspace_text,
)
from ..services.event_bus import EventBus, get_event_bus
from ..services.task_service import TaskService

log = logging.getLogger("edict.api.tasks")
router = APIRouter()

WORKSPACE_EDIT_LOCKED_STATES = {
    TaskState.ControlCenter,
    TaskState.PlanCenter,
    TaskState.ReviewCenter,
    TaskState.Assigned,
    TaskState.Next,
    TaskState.Doing,
    TaskState.Review,
}


# ── Schemas ──

class TaskCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "中"
    assignee_org: str | None = None
    creator: str = "system"
    tags: list[str] = []
    meta: dict | None = None


class TaskTransition(BaseModel):
    new_state: str
    agent: str = "system"
    reason: str = ""


class TaskProgress(BaseModel):
    agent: str
    content: str


class TaskTodoUpdate(BaseModel):
    todos: list[dict]


class TaskSchedulerUpdate(BaseModel):
    scheduler: dict


class TaskWorkspacePatch(BaseModel):
    patch: dict = Field(default_factory=dict)
    agent: str = "system"
    summary: str = "任务工作区元数据已更新。"


class TaskWorkspaceArchiveRequest(BaseModel):
    agent: str = "system"


class TaskWorkspaceReactivateRequest(BaseModel):
    agent: str = "system"
    move_to_hot: bool | None = None


class TaskWatchdogRequest(BaseModel):
    agent: str = "watchdog"


class TaskWorkspaceTextSaveRequest(BaseModel):
    path: str
    content: str = ""
    agent: str = "system"


class TaskDeleteRequest(BaseModel):
    agent: str = "system"
    reason: str = ""
    delete_workspace: bool = True
    confirm: bool = False
    confirm_text: str = ""


class TaskNotificationCreate(BaseModel):
    title: str
    message: str
    source: str = "system"
    kind: str = "info"
    severity: str = "info"
    requires_ack: bool = False
    meta: dict = Field(default_factory=dict)


class TaskRiskControlUpdate(BaseModel):
    status: str
    level: str = "low"
    summary: str = ""
    requested_by: str = "system"
    requires_user_confirmation: bool = False
    confirmation_channel: str = ""
    approval_status: str = "not_required"
    approval_reason: str = ""
    approved_by: str = ""
    operations: list[dict] = Field(default_factory=list)


class TaskOut(BaseModel):
    task_id: str
    trace_id: str
    title: str
    description: str
    priority: str
    state: str
    assignee_org: str | None
    creator: str
    tags: list[str]
    flow_log: list
    progress_log: list
    todos: list
    scheduler: dict | None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ── 依赖注入 helper ──

async def get_task_service(
    db: AsyncSession = Depends(get_db),
) -> TaskService:
    bus = await get_event_bus()
    return TaskService(db, bus)


# ── Endpoints ──

@router.get("")
async def list_tasks(
    state: str | None = None,
    assignee_org: str | None = None,
    priority: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    svc: TaskService = Depends(get_task_service),
):
    """获取任务列表。"""
    task_state = TaskState(state) if state else None
    tasks = await svc.list_tasks(
        state=task_state,
        assignee_org=assignee_org,
        priority=priority,
        limit=limit,
        offset=offset,
    )
    return {"tasks": [t.to_dict() for t in tasks], "count": len(tasks)}


@router.get("/live-status")
async def live_status(svc: TaskService = Depends(get_task_service)):
    """返回统一的全局实时状态视图。"""
    return await svc.get_live_status()


@router.get("/stats")
async def task_stats(svc: TaskService = Depends(get_task_service)):
    """任务统计。"""
    stats = {}
    for s in TaskState:
        stats[s.value] = await svc.count_tasks(s)
    total = sum(stats.values())
    return {"total": total, "by_state": stats}


@router.post("", status_code=201)
async def create_task(
    body: TaskCreate,
    svc: TaskService = Depends(get_task_service),
):
    """创建新任务。"""
    task = await svc.create_task(
        title=body.title,
        description=body.description,
        priority=body.priority,
        assignee_org=body.assignee_org,
        creator=body.creator,
        tags=body.tags,
        meta=body.meta,
    )
    return {"task_id": str(task.task_id), "trace_id": str(task.trace_id), "state": task.state.value}


@router.get("/{task_id}")
async def get_task(
    task_id: uuid.UUID,
    svc: TaskService = Depends(get_task_service),
):
    """获取任务详情。"""
    try:
        task = await svc.get_task(task_id)
        return task.to_dict()
    except ValueError:
        raise HTTPException(status_code=404, detail="Task not found")


@router.post("/{task_id}/transition")
async def transition_task(
    task_id: uuid.UUID,
    body: TaskTransition,
    svc: TaskService = Depends(get_task_service),
):
    """执行状态流转。"""
    try:
        new_state = TaskState(body.new_state)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid state: {body.new_state}")

    try:
        task = await svc.transition_state(
            task_id=task_id,
            new_state=new_state,
            agent=body.agent,
            reason=body.reason,
        )
        return {"task_id": str(task.task_id), "state": task.state.value, "message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{task_id}/dispatch")
async def dispatch_task(
    task_id: uuid.UUID,
    agent: str = Query(description="目标中心或专家 ID"),
    message: str = Query(default="", description="派发说明"),
    svc: TaskService = Depends(get_task_service),
):
    """手动派发任务给指定中心或专家。"""
    try:
        await svc.request_dispatch(task_id, agent, message)
        return {"message": "dispatch requested", "target": agent}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/progress")
async def add_progress(
    task_id: uuid.UUID,
    body: TaskProgress,
    svc: TaskService = Depends(get_task_service),
):
    """添加进度记录。"""
    try:
        await svc.add_progress(task_id, body.agent, body.content)
        return {"message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{task_id}/todos")
async def update_todos(
    task_id: uuid.UUID,
    body: TaskTodoUpdate,
    svc: TaskService = Depends(get_task_service),
):
    """更新任务 TODO 清单。"""
    try:
        await svc.update_todos(task_id, body.todos)
        return {"message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{task_id}/scheduler")
async def update_scheduler(
    task_id: uuid.UUID,
    body: TaskSchedulerUpdate,
    svc: TaskService = Depends(get_task_service),
):
    """更新任务排期信息。"""
    try:
        await svc.update_scheduler(task_id, body.scheduler)
        return {"message": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{task_id}/workspace")
async def patch_workspace(
    task_id: uuid.UUID,
    body: TaskWorkspacePatch,
    svc: TaskService = Depends(get_task_service),
):
    """更新任务工作区元数据。"""
    try:
        task = await svc.update_workspace_meta(task_id, body.patch, agent=body.agent, summary=body.summary)
        return {"message": "ok", "workspace": (task.meta or {}).get("workspace", {})}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/workspace/notifications")
async def create_workspace_notification(
    task_id: uuid.UUID,
    body: TaskNotificationCreate,
    svc: TaskService = Depends(get_task_service),
):
    """创建任务工作区通知。"""
    try:
        task = await svc.create_workspace_notification(
            task_id,
            title=body.title,
            message=body.message,
            source=body.source,
            kind=body.kind,
            severity=body.severity,
            requires_ack=body.requires_ack,
            meta=body.meta,
        )
        return {"message": "ok", "notifications": ((task.meta or {}).get("workspace") or {}).get("notifications", [])}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/workspace/risk-control")
async def update_workspace_risk_control(
    task_id: uuid.UUID,
    body: TaskRiskControlUpdate,
    svc: TaskService = Depends(get_task_service),
):
    """更新任务工作区风险控制状态。"""
    try:
        task = await svc.update_workspace_risk_control(
            task_id,
            status=body.status,
            level=body.level,
            summary=body.summary,
            requested_by=body.requested_by,
            requires_user_confirmation=body.requires_user_confirmation,
            confirmation_channel=body.confirmation_channel,
            approval_status=body.approval_status,
            approval_reason=body.approval_reason,
            approved_by=body.approved_by,
            operations=body.operations,
        )
        return {"message": "ok", "risk_control": ((task.meta or {}).get("workspace") or {}).get("risk_control", {})}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/workspace/archive")
async def archive_workspace(
    task_id: uuid.UUID,
    body: TaskWorkspaceArchiveRequest,
    svc: TaskService = Depends(get_task_service),
):
    """将任务工作区迁入冷存储。"""
    try:
        task = await svc.archive_workspace(task_id, agent=body.agent)
        return {"message": "ok", "workspace": (task.meta or {}).get("workspace", {}), "archived": task.archived}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/workspace/reactivate")
async def reactivate_workspace(
    task_id: uuid.UUID,
    body: TaskWorkspaceReactivateRequest,
    svc: TaskService = Depends(get_task_service),
):
    """重新激活已冷归档的任务工作区。"""
    try:
        task = await svc.reactivate_workspace(task_id, agent=body.agent, move_to_hot=body.move_to_hot)
        return {"message": "ok", "workspace": (task.meta or {}).get("workspace", {}), "archived": task.archived}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{task_id}/workspace/files")
async def list_workspace_files(
    task_id: uuid.UUID,
    path: str = Query(default=""),
    svc: TaskService = Depends(get_task_service),
):
    """浏览任务工作区目录。"""
    try:
        task = await svc.get_task(task_id)
        payload = list_task_workspace_entries(task.to_dict(), path)
        return {"message": "ok", **payload}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{task_id}/workspace/file")
async def read_workspace_file(
    task_id: uuid.UUID,
    path: str = Query(...),
    svc: TaskService = Depends(get_task_service),
):
    """读取任务工作区中的文本文件。"""
    try:
        task = await svc.get_task(task_id)
        payload = read_task_workspace_text(task.to_dict(), path)
        return {
            "message": "ok",
            **payload,
            "readonly": task.state in WORKSPACE_EDIT_LOCKED_STATES,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{task_id}/workspace/file")
async def save_workspace_file(
    task_id: uuid.UUID,
    body: TaskWorkspaceTextSaveRequest,
    svc: TaskService = Depends(get_task_service),
):
    """保存任务工作区中的文本文件。"""
    try:
        task = await svc.get_task(task_id)
        if task.state in WORKSPACE_EDIT_LOCKED_STATES:
            raise HTTPException(status_code=409, detail="任务运行中，当前仅允许查看工作区文件。")
        payload = write_task_workspace_text(task.to_dict(), body.path, body.content)
        return {"message": "ok", **payload}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{task_id}/workspace/download")
async def download_workspace_file(
    task_id: uuid.UUID,
    path: str = Query(...),
    svc: TaskService = Depends(get_task_service),
):
    """下载任务工作区中的单个文件。"""
    try:
        task = await svc.get_task(task_id)
        target, filename = resolve_task_workspace_download_path(task.to_dict(), path)
        return FileResponse(path=str(target), filename=filename, media_type="application/octet-stream")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{task_id}/workspace/archive/download")
async def download_workspace_archive(
    task_id: uuid.UUID,
    paths: list[str] = Query(default=[]),
    svc: TaskService = Depends(get_task_service),
):
    """打包下载整个任务工作区，或按所选路径集合导出 zip。"""
    try:
        task = await svc.get_task(task_id)
        archive_path, filename = create_task_workspace_archive(task.to_dict(), paths or None)
        return FileResponse(path=str(archive_path), filename=filename, media_type="application/zip")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/delete")
async def delete_task(
    task_id: uuid.UUID,
    body: TaskDeleteRequest,
    svc: TaskService = Depends(get_task_service),
):
    """删除任务，并按需同步删除对应工作区。"""
    try:
        task = await svc.get_task(task_id)
        if not body.confirm or body.confirm_text.strip() != str(task_id):
            raise HTTPException(status_code=400, detail="删除任务需要二次确认，并输入当前任务 ID。")
        payload = await svc.delete_task(
            task_id,
            agent=body.agent,
            reason=body.reason,
            delete_workspace=body.delete_workspace,
        )
        return {"message": "ok", **payload}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{task_id}/watchdog")
async def run_workspace_watchdog(
    task_id: uuid.UUID,
    body: TaskWatchdogRequest,
    svc: TaskService = Depends(get_task_service),
):
    """执行单任务看门狗巡检。"""
    try:
        task = await svc.run_watchdog(task_id, agent=body.agent)
        return {"message": "ok", "watchdog": ((task.meta or {}).get("workspace") or {}).get("watchdog", {})}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
