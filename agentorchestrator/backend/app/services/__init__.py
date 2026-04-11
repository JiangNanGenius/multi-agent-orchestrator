"""Service package exports.

避免在包导入阶段触发 event_bus 的 redis 依赖，降低非事件链路（例如 dashboard）
在无 redis 环境下的导入耦合风险。
"""

from .task_service import TaskService

__all__ = ["TaskService", "EventBus", "get_event_bus"]


def __getattr__(name: str):
    if name in {"EventBus", "get_event_bus"}:
        from .event_bus import EventBus, get_event_bus

        return {"EventBus": EventBus, "get_event_bus": get_event_bus}[name]
    raise AttributeError(name)
