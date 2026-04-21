"""WebSocket 端点 — 实时推送事件到前端。"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.event_bus import get_event_bus

log = logging.getLogger("agentorchestrator.ws")
router = APIRouter()

# 活跃连接管理
_connections: set[WebSocket] = set()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """主 WebSocket 端点 — 推送所有事件。"""
    await ws.accept()
    _connections.add(ws)
    log.info(f"WebSocket connected. Total: {len(_connections)}")

    bus = await get_event_bus()

    try:
        # 并发：监听事件总线 + 客户端消息
        await asyncio.gather(
            _relay_events(bus, ws),
            _handle_client_messages(ws),
        )
    except WebSocketDisconnect:
        log.info("WebSocket disconnected")
    except Exception as e:
        log.error(f"WebSocket error: {e}")
    finally:
        _connections.discard(ws)
        log.info(f"WebSocket cleaned up. Remaining: {len(_connections)}")


async def _relay_events(bus, ws: WebSocket):
    """从 EventBus 轮询事件并推送到 WebSocket。"""
    last_id = 0
    while True:
        try:
            events = await bus.poll_since(last_id, limit=200)
            for entry_id, event_data in events:
                last_id = max(last_id, int(str(entry_id).split("-", 1)[0]))
                await ws.send_json(
                    {
                        "type": "event",
                        "topic": event_data.get("topic", ""),
                        "data": event_data,
                    }
                )
            await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            raise
        except Exception as e:
            log.warning(f"Failed to relay event: {e}")
            await asyncio.sleep(1)


async def _handle_client_messages(ws: WebSocket):
    """处理客户端发送的消息（心跳、订阅过滤等）。"""
    while True:
        try:
            data = await ws.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})
            elif msg_type == "subscribe":
                # 前端可请求只订阅特定 topic（未来扩展）
                topics = data.get("topics", [])
                log.debug(f"Client subscribe request: {topics}")
                await ws.send_json({"type": "subscribed", "topics": topics})
            else:
                log.debug(f"Unknown client message: {msg_type}")

        except WebSocketDisconnect:
            raise
        except Exception:
            break


@router.websocket("/ws/task/{task_id}")
async def task_websocket(ws: WebSocket, task_id: str):
    """单任务 WebSocket — 只推送与特定任务相关的事件。"""
    await ws.accept()
    _connections.add(ws)

    bus = await get_event_bus()
    last_id = 0

    try:
        while True:
            events = await bus.poll_since(last_id, limit=200)
            for entry_id, event_data in events:
                last_id = max(last_id, int(str(entry_id).split("-", 1)[0]))
                try:
                    payload = event_data.get("payload", {})
                    if isinstance(payload, str):
                        payload = json.loads(payload)

                    # 只转发与此任务相关的事件
                    if payload.get("task_id") == task_id:
                        topic = event_data.get("topic", "")
                        await ws.send_json({
                            "type": "event",
                            "topic": topic,
                            "data": event_data,
                        })
                except Exception:
                    continue
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    finally:
        _connections.discard(ws)


async def broadcast(event: dict):
    """向所有连接的 WebSocket 客户端广播事件（服务端内部调用用）。"""
    dead = set()
    for ws in _connections:
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    _connections -= dead
