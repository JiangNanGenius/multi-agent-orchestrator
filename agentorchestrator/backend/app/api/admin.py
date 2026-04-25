"""Admin API — 管理操作（迁移、诊断、配置）。"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from ..db import get_db
from ..logging_utils import LOG_TARGETS, log_runtime_metadata, read_recent_log_lines
from ..services.event_bus import get_event_bus

log = logging.getLogger("agentorchestrator.api.admin")
router = APIRouter()


@router.get("/health/deep")
async def deep_health(db: AsyncSession = Depends(get_db)):
    """深度健康检查：主数据库 + EventBus 连通性。"""
    checks = {"database": False, "event_bus": False, "event_bus_backend": "unknown"}

    try:
        result = await db.execute(text("SELECT 1"))
        checks["database"] = result.scalar() == 1
    except Exception as e:
        checks["database_error"] = str(e)

    try:
        bus = await get_event_bus()
        async with bus.engine.begin() as conn:
            result = await conn.execute(text("SELECT 1"))
            checks["event_bus"] = result.scalar() == 1
            checks["event_bus_backend"] = bus.backend_kind
    except Exception as e:
        checks["event_bus_error"] = str(e)

    status = "ok" if checks.get("database") and checks.get("event_bus") else "degraded"
    return {"status": status, "checks": checks}


@router.get("/pending-events")
async def pending_events(
    topic: str = "task.dispatch",
    group: str = "dispatcher",
    count: int = 20,
):
    """查看未 ACK 的 pending 事件（诊断工具）。"""
    bus = await get_event_bus()
    pending = await bus.get_pending(topic, group, count)
    return {
        "topic": topic,
        "group": group,
        "pending": [
            {
                "entry_id": str(p.get("message_id", "")),
                "consumer": str(p.get("consumer", "")),
                "idle_ms": p.get("time_since_delivered", 0),
                "delivery_count": p.get("times_delivered", 0),
            }
            for p in pending
        ] if pending else [],
    }


@router.post("/migrate/check")
async def migration_check():
    """检查旧数据文件是否存在。"""
    data_dir = Path(__file__).parents[4] / "data"
    files = {
        "tasks_source": (data_dir / "tasks_source.json").exists(),
        "live_status": (data_dir / "live_status.json").exists(),
        "agent_config": (data_dir / "agent_config.json").exists(),
        "officials_stats": (data_dir / "officials_stats.json").exists(),
    }
    return {"data_dir": str(data_dir), "files": files}


@router.get("/config")
async def get_config():
    """获取当前运行配置（脱敏）。"""
    from ..config import get_settings
    settings = get_settings()
    return {
        "port": settings.port,
        "debug": settings.debug,
        "database": settings.database_url,
        "event_bus": settings.mysql_url if settings.mysql_url_override else settings.sqlite_event_bus_url,
        "scheduler_scan_interval": settings.scheduler_scan_interval_seconds,
    }


@router.get("/logs")
async def agent_runtime_logs(
    target: str = Query(default="dispatch"),
    limit: int = Query(default=160),
):
    """读取面向 Agent 排错的最近滚动日志。"""
    if target not in LOG_TARGETS:
        raise HTTPException(status_code=404, detail=f"unknown log target: {target}")
    limit = max(20, min(limit, 400))
    lines = read_recent_log_lines(target, limit)
    return {
        "target": target,
        "targets": sorted(LOG_TARGETS),
        "limit": limit,
        "lines": lines,
        "log": "\n".join(lines),
        "meta": log_runtime_metadata(target),
    }
