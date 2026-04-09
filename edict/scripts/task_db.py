from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import async_session  # noqa: E402
from app.models.task import Task, TaskState  # noqa: E402
from app.services.event_bus import get_event_bus  # noqa: E402
from app.services.task_service import TaskService  # noqa: E402
from app.services.task_workspace import (  # noqa: E402
    TASK_WORKSPACE_INDEX_DIR,
    get_cold_workspace_root,
    get_hot_workspace_root,
)
from sqlalchemy import select  # noqa: E402


def jprint(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def load_index(name: str) -> dict[str, Any]:
    path = TASK_WORKSPACE_INDEX_DIR / name
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def parse_meta(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    return json.loads(text)


async def create_task(args: argparse.Namespace) -> None:
    async with async_session() as session:
        bus = await get_event_bus()
        svc = TaskService(session, bus)
        state = TaskState(args.initial_state)
        task = await svc.create_task(
            title=args.title,
            description=args.description,
            priority=args.priority,
            assignee_org=args.assignee_org,
            creator=args.creator,
            tags=args.tags,
            initial_state=state,
            meta=parse_meta(args.meta),
        )
        data = task.to_dict()
        jprint(
            {
                "message": "created",
                "task_id": data["task_id"],
                "task_code": data.get("taskCode", ""),
                "workspace_path": data.get("workspacePath", ""),
                "workspace_actual_path": data.get("workspaceActualPath", ""),
                "workspace_storage_tier": data.get("workspaceStorageTier", "hot"),
                "workspace_task_kind": data.get("workspaceTaskKind", "standard"),
                "workspace_task_policy": data.get("workspaceTaskPolicy", {}),
                "workspace_new_refresh": data.get("workspaceNewRefresh", {}),
            }
        )


async def get_task(args: argparse.Namespace) -> None:
    async with async_session() as session:
        task = await session.get(Task, uuid.UUID(args.task_id))
        if not task:
            raise SystemExit(f"Task not found: {args.task_id}")
        jprint(task.to_dict())


async def list_tasks(args: argparse.Namespace) -> None:
    async with async_session() as session:
        stmt = select(Task).order_by(Task.created_at.desc()).limit(args.limit)
        result = await session.execute(stmt)
        tasks = [task.to_dict() for task in result.scalars().all()]
        if args.state:
            tasks = [item for item in tasks if item.get("state") == args.state]
        if args.archived == "yes":
            tasks = [item for item in tasks if item.get("archived")]
        elif args.archived == "no":
            tasks = [item for item in tasks if not item.get("archived")]
        rows = []
        for item in tasks:
            rows.append(
                {
                    "task_id": item.get("task_id"),
                    "task_code": item.get("taskCode"),
                    "title": item.get("title"),
                    "state": item.get("state"),
                    "archived": item.get("archived"),
                    "storage_tier": item.get("workspaceStorageTier"),
                    "processing_location": item.get("workspaceProcessingLocation"),
                    "archive_status": item.get("workspaceArchiveStatus"),
                    "task_kind": item.get("workspaceTaskKind"),
                    "task_policy": item.get("workspaceTaskPolicy"),
                    "new_refresh": item.get("workspaceNewRefresh"),
                    "workspace_path": item.get("workspacePath"),
                    "workspace_actual_path": item.get("workspaceActualPath"),
                }
            )
        jprint({"count": len(rows), "tasks": rows})


async def patch_workspace(args: argparse.Namespace) -> None:
    async with async_session() as session:
        bus = await get_event_bus()
        svc = TaskService(session, bus)
        task = await svc.update_workspace_meta(
            uuid.UUID(args.task_id),
            patch=parse_meta(args.patch),
            agent=args.agent,
            summary=args.summary,
        )
        jprint(
            {
                "message": "workspace_updated",
                "task_id": str(task.task_id),
                "workspace": (task.meta or {}).get("workspace", {}),
            }
        )


async def archive_task(args: argparse.Namespace) -> None:
    async with async_session() as session:
        bus = await get_event_bus()
        svc = TaskService(session, bus)
        task = await svc.archive_workspace(uuid.UUID(args.task_id), agent=args.agent)
        jprint(
            {
                "message": "archived",
                "task_id": str(task.task_id),
                "archived": task.archived,
                "workspace": (task.meta or {}).get("workspace", {}),
            }
        )


async def reactivate_task(args: argparse.Namespace) -> None:
    async with async_session() as session:
        bus = await get_event_bus()
        svc = TaskService(session, bus)
        move_to_hot = None
        if args.mode == "hot":
            move_to_hot = True
        elif args.mode == "cold":
            move_to_hot = False
        task = await svc.reactivate_workspace(uuid.UUID(args.task_id), agent=args.agent, move_to_hot=move_to_hot)
        jprint(
            {
                "message": "reactivated",
                "task_id": str(task.task_id),
                "archived": task.archived,
                "workspace": (task.meta or {}).get("workspace", {}),
            }
        )


async def watchdog_task(args: argparse.Namespace) -> None:
    async with async_session() as session:
        bus = await get_event_bus()
        svc = TaskService(session, bus)
        if args.task_id:
            task = await svc.run_watchdog(uuid.UUID(args.task_id), agent=args.agent)
            jprint(
                {
                    "task_id": str(task.task_id),
                    "task_code": task.to_dict().get("taskCode", ""),
                    "watchdog": ((task.meta or {}).get("workspace") or {}).get("watchdog", {}),
                }
            )
            return

        stmt = select(Task).order_by(Task.updated_at.desc()).limit(args.limit)
        result = await session.execute(stmt)
        tasks = list(result.scalars().all())
        output = []
        for task in tasks:
            updated = await svc.run_watchdog(task.task_id, agent=args.agent)
            watchdog = ((updated.meta or {}).get("workspace") or {}).get("watchdog", {})
            output.append(
                {
                    "task_id": str(updated.task_id),
                    "task_code": updated.to_dict().get("taskCode", ""),
                    "status": watchdog.get("status", "unknown"),
                    "issues": watchdog.get("issues", []),
                    "repairs": watchdog.get("repairs", []),
                }
            )
        jprint({"count": len(output), "items": output})


def show_index(args: argparse.Namespace) -> None:
    filename = "archive_index.json" if args.kind == "archive" else "task_index.json"
    jprint(load_index(filename))


def show_roots(_: argparse.Namespace) -> None:
    jprint(
        {
            "hot_root": str(get_hot_workspace_root()),
            "cold_root": str(get_cold_workspace_root()),
            "index_root": str(TASK_WORKSPACE_INDEX_DIR),
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="任务工作区数据库与账本管理脚本")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("roots", help="查看热数据、冷数据与索引目录")
    p.set_defaults(func=lambda args: show_roots(args))

    p = sub.add_parser("index", help="查看任务索引或归档索引")
    p.add_argument("kind", choices=["task", "archive"])
    p.set_defaults(func=lambda args: show_index(args))

    p = sub.add_parser("create", help="创建任务并初始化工作区")
    p.add_argument("title")
    p.add_argument("--description", default="")
    p.add_argument("--priority", default="中")
    p.add_argument("--assignee-org", default=None)
    p.add_argument("--creator", default="task_db")
    p.add_argument("--initial-state", default="ControlCenter", choices=[s.value for s in TaskState])
    p.add_argument("--tag", dest="tags", action="append", default=[])
    p.add_argument("--meta", default="{}", help="JSON 字符串，例如 '{\"project_size_gb_estimate\": 120}'")
    p.set_defaults(func=create_task)

    p = sub.add_parser("get", help="查看单个任务详情")
    p.add_argument("task_id")
    p.set_defaults(func=get_task)

    p = sub.add_parser("list", help="列出任务")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--state", default=None)
    p.add_argument("--archived", choices=["all", "yes", "no"], default="all")
    p.set_defaults(func=list_tasks)

    p = sub.add_parser("patch-workspace", help="更新工作区元数据")
    p.add_argument("task_id")
    p.add_argument("patch", help="JSON 字符串")
    p.add_argument("--agent", default="task_db")
    p.add_argument("--summary", default="通过 task_db 更新任务工作区元数据。")
    p.set_defaults(func=patch_workspace)

    p = sub.add_parser("archive", help="将任务工作区移入冷存储")
    p.add_argument("task_id")
    p.add_argument("--agent", default="task_db")
    p.set_defaults(func=archive_task)

    p = sub.add_parser("reactivate", help="重新激活任务工作区")
    p.add_argument("task_id")
    p.add_argument("--agent", default="task_db")
    p.add_argument("--mode", choices=["auto", "hot", "cold"], default="auto")
    p.set_defaults(func=reactivate_task)

    p = sub.add_parser("watchdog", help="执行看门狗巡检")
    p.add_argument("--task-id", default=None)
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--agent", default="watchdog")
    p.set_defaults(func=watchdog_task)

    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    result = args.func(args)
    if asyncio.iscoroutine(result):
        await result


if __name__ == "__main__":
    asyncio.run(main())
