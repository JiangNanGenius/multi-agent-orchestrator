"""Compatibility API endpoints for dashboard-era frontend contracts."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..services.task_service import TaskService
from ..services.event_bus import get_event_bus

router = APIRouter()


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
