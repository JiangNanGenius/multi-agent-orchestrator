#!/usr/bin/env python3
"""
卡停任务一键恢复工具

功能：
1. 自动检测所有卡停任务
2. 根据卡停位置自动执行恢复流程
3. ControlCenter卡停 → 自动添加progress提醒并尝试转交规划中心
4. PlanCenter卡停 → 自动添加progress提醒
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select, and_, not_  # noqa: E402

from app.db import async_session  # noqa: E402
from app.models.task import Task, TaskState  # noqa: E402
from app.services.task_service import TaskService  # noqa: E402


TERMINAL_STATES = {TaskState.Done, TaskState.Cancelled}


def jprint(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


async def recover_stuck_task(task: Task, svc: TaskService, args: argparse.Namespace) -> dict[str, Any]:
    """恢复单个卡停任务。"""
    task_id = task.task_id
    task_code = task.to_dict().get("taskCode", "")
    task_state = str(task.state.value) if hasattr(task.state, "value") else str(task.state)
    title = task.title

    result = {
        "task_id": str(task_id),
        "task_code": task_code,
        "title": title,
        "state": task_state,
        "recovery_actions": [],
        "status": "success",
    }

    try:
        # 通用：添加卡停提醒
        await svc.add_progress(
            task_id,
            agent="stuck_recovery",
            content=f"🔧 卡停恢复工具检测到任务卡停（状态：{task_state}），正在执行恢复流程。",
        )
        result["recovery_actions"].append("added_stuck_reminder")

        # 根据状态执行不同恢复策略
        if task_state == "ControlCenter" and args.auto_flow:
            # 总控中心卡停：自动转交规划中心
            try:
                await svc.transition_state(
                    task_id,
                    TaskState.PlanCenter,
                    agent="stuck_recovery",
                    reason=f"卡停恢复：自动从{task_state}转交规划中心",
                )
                await svc.add_progress(
                    task_id,
                    agent="stuck_recovery",
                    content="✅ 卡停恢复完成：任务已自动转交规划中心，请规划中心继续执行。",
                )
                result["recovery_actions"].append("auto_transition_to_PlanCenter")
            except Exception as e:
                result["status"] = "partial_success"
                result["error"] = str(e)
                await svc.add_progress(
                    task_id,
                    agent="stuck_recovery",
                    content=f"⚠️ 自动流转失败：{str(e)}，请人工介入处理。",
                )

        elif task_state == "PlanCenter":
            # 规划中心卡停：添加提醒，等待调度中心或人工处理
            await svc.add_progress(
                task_id,
                agent="stuck_recovery",
                content="⚠️ 卡停恢复提示：请规划中心检查任务并继续执行，或检查是否缺少必要的输入文件。",
            )
            result["recovery_actions"].append("added_plan_center_reminder")

        elif task_state in {"DispatchCenter", "ReviewCenter"}:
            # 其他中心卡停
            await svc.add_progress(
                task_id,
                agent="stuck_recovery",
                content=f"⚠️ 卡停恢复提示：任务停留在{task_state}状态，请对应中心检查并继续执行。",
            )
            result["recovery_actions"].append(f"added_{task_state}_reminder")

        else:
            result["recovery_actions"].append("generic_reminder_added")

        # 再次运行看门狗更新状态
        await svc.run_watchdog(task_id, agent="stuck_recovery")

    except Exception as e:
        result["status"] = "failed"
        result["error"] = str(e)

    return result


async def run_recovery(args: argparse.Namespace) -> None:
    """运行卡停恢复。"""
    results: list[dict[str, Any]] = []

    async with async_session() as session:
        # 查询所有未完成的任务
        stmt = select(Task).where(
            and_(
                not_(Task.state.in_(TERMINAL_STATES)),
                Task.archived == False,
            )
        ).order_by(Task.updated_at.desc()).limit(args.limit)

        result = await session.execute(stmt)
        tasks = list(result.scalars().all())

        svc = TaskService(session, event_bus=None)

        for task in tasks:
            # 先运行看门狗检测
            updated = await svc.run_watchdog(task.task_id, agent="stuck_recovery")
            data = updated.to_dict()
            workspace = (data.get("meta") or {}).get("workspace") or {}
            watchdog = workspace.get("watchdog") or {}

            is_stuck = watchdog.get("status") == "stuck"

            if is_stuck or args.force_all:
                recovery_result = await recover_stuck_task(task, svc, args)
                recovery_result["was_stuck"] = is_stuck
                results.append(recovery_result)

        await session.commit()

    summary = {
        "checked": len(tasks) if 'tasks' in dir() else 0,
        "recovered": len(results),
        "success": len([r for r in results if r.get("status") == "success"]),
        "failed": len([r for r in results if r.get("status") == "failed"]),
        "results": results,
        "run_at": datetime.now(timezone.utc).isoformat(),
    }

    jprint(summary)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="卡停任务一键恢复工具"
    )
    parser.add_argument("--task-id", default=None, help="仅恢复指定任务")
    parser.add_argument("--limit", type=int, default=20, help="最多检查多少个任务")
    parser.add_argument("--auto-flow", action="store_true", help="允许自动流转状态（ControlCenter→PlanCenter）")
    parser.add_argument("--force-all", action="store_true", help="即使未检测到卡停也对所有任务执行恢复")
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.task_id:
        print(f"恢复指定任务: {args.task_id}")
        # 单任务恢复逻辑...
    else:
        await run_recovery(args)


if __name__ == "__main__":
    asyncio.run(main())
