"""AgentOrchestrator Backend — FastAPI 应用入口。

Lifespan 管理：
- startup: 连接 Redis Event Bus, 初始化数据库
- shutdown: 关闭连接

路由：
- /api/tasks — 任务 CRUD
- /api/agents — Agent 信息
- /api/events — 事件查询
- /api/admin — 管理操作
- /ws — WebSocket 实时推送
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .logging_utils import configure_process_logging
from .services.event_bus import get_event_bus
from .api import tasks, agents, events, admin, websocket, compat
from .api import legacy

configure_process_logging("api")
log = logging.getLogger("multi_agent_orchestrator")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    settings = get_settings()
    log.info(f"🏛️ Multi-Agent Orchestrator Backend starting on port {settings.port}...")

    await init_db()
    log.info("✅ Database schema ready")

    # 连接 Event Bus
    bus = await get_event_bus()
    log.info("✅ Event Bus connected")

    yield

    # 清理
    await bus.close()
    log.info("Multi-Agent Orchestrator Backend shutdown complete")


app = FastAPI(
    title="Multi-Agent Orchestrator",
    description="事件驱动的 AI Agent 协作平台",
    version="2.0.1",
    lifespan=lifespan,
)

# CORS — 开发环境允许所有来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(websocket.router, tags=["websocket"])
app.include_router(legacy.router, prefix="/api/tasks", tags=["legacy"])
app.include_router(compat.router, tags=["compat"])


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.1", "engine": "multi-agent-orchestrator"}


@app.get("/api")
async def api_root():
    return {
        "name": "Multi-Agent Orchestrator API",
        "version": "2.0.1",
        "endpoints": {
            "tasks": "/api/tasks",
            "agents": "/api/agents",
            "events": "/api/events",
            "admin": "/api/admin",
            "websocket": "/ws",
            "health": "/health",
        },
    }
