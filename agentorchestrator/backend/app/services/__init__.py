"""Service package exports.

避免在包导入阶段触发重量级依赖（如 redis / sqlalchemy），
降低正式版前端等轻量调用链路的导入耦合风险。
"""

__all__ = ["TaskService", "EventBus", "get_event_bus"]


def __getattr__(name: str):
    if name == "TaskService":
        from .task_service import TaskService

        return TaskService
    if name in {"EventBus", "get_event_bus"}:
        from .event_bus import EventBus, get_event_bus

        return {"EventBus": EventBus, "get_event_bus": get_event_bus}[name]
    raise AttributeError(name)
