#!/usr/bin/env python3
"""
卡停检测器 - 主动巡检并自动恢复卡住的任务

功能：
1. 定时扫描所有未完成的任务
2. 智能检测卡停状态
3. 自动推送飞书告警
4. 自动尝试恢复（可选）
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

from app.channels.feishu import FeishuChannel  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import async_session  # noqa: E402
from app.models.task import Task, TaskState  # noqa: E402
from app.services.task_service import TaskService  # noqa: E402


TERMINAL_STATES = {TaskState.Done, TaskState.Cancelled}


def jprint(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _build_stuck_alert(item: dict[str, Any]) -> str:
    """生成卡停告警内容。"""
    watchdog = item.get("watchdog") or {}
    stuck_detection = watchdog.get("stuck_detection") or ["未知卡停原因"]
    issues = watchdog.get("issues") or []
    issue_text = "、".join(issues) if issues else "无"

    return (
        f"**🔴 任务卡停告警**\n"
        f"**任务代号**：`{item.get('task_code', '')}`\n"
        f"**任务标题**：{item.get('title', '')}\n"
        f"**当前状态**：`{item.get('state', '')}`\n"
        f"**卡停时长**：`{item.get('idle_minutes', 0)} 分钟`\n"
        f"**创建时间**：`{item.get('created_at', '')}`\n"
        f"**检测结果**：{'; '.join(stuck_detection)}\n"
        f"**建议处理**：{watchdog.get('recommended_action') or '请人工介入检查'}\n"
        f"\n⚠️ **此任务已被看门狗标记为卡停状态，需要您的关注！**"
    )


async def detect_and_recover(args: argparse.Namespace) -> None:
    """检测卡停任务并尝试恢复。"""
    settings = get_settings()
    results: list[dict[str, Any]] = []
    stuck_tasks: list[dict[str, Any]] = []

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
            # 运行看门狗检测（会自动标记卡停）
            updated = await svc.run_watchdog(task.task_id, agent="stuck_detector")
            data = updated.to_dict()
            workspace = (data.get("meta") or {}).get("workspace") or {}
            watchdog = workspace.get("watchdog") or {}

            item = {
                "task_id": data.get("task_id", ""),
                "task_code": data.get("taskCode", ""),
                "title": data.get("title", ""),
                "state": data.get("state", ""),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "watchdog_status": watchdog.get("status", "unknown"),
                "watchdog": watchdog,
                "idle_minutes": watchdog.get("idle_since_minutes", 0),
                "is_stuck": watchdog.get("status") == "stuck",
            }
            results.append(item)

            if item["is_stuck"]:
                stuck_tasks.append(item)

                # 自动恢复逻辑
                if args.auto_recover:
                    task_state = item["state"]

                    # 卡在总控中心：自动添加进展记录并提醒
                    if task_state == "ControlCenter":
                        await svc.add_progress(
                            task.task_id,
                            agent="stuck_detector",
                            content="🔴 看门狗检测到任务卡停（总控中心未流转），请检查并转交规划中心继续执行。",
                        )
                        item["recovery_attempted"] = "added_progress_reminder"

    # 统计
    summary = {
        "checked": len(results),
        "stuck_detected": len(stuck_tasks),
        "healthy": len([r for r in results if r["watchdog_status"] == "healthy"]),
        "attention_needed": len([r for r in results if r["watchdog_status"] in {"attention", "warning"}]),
        "stuck_tasks": stuck_tasks,
        "implementation": "主动巡检脚本 v1.0",
        "run_at": datetime.now(timezone.utc).isoformat(),
    }

    # 推送飞书告警
    webhook = args.feishu_webhook or settings.workspace_watchdog_feishu_webhook or settings.feishu_report_webhook
    if args.notify and webhook and stuck_tasks:
        content = "\n\n---\n\n".join(_build_stuck_alert(item) for item in stuck_tasks[:10])
        FeishuChannel.send(
            webhook=webhook,
            title=f"🔴 卡停巡检告警：发现 {len(stuck_tasks)} 个任务卡停",
            content=content,
            extra={
                "checked": len(results),
                "stuck": len(stuck_tasks),
                "auto_recover_enabled": args.auto_recover,
            },
        )
        summary["notification"] = "sent"
    elif args.notify and webhook and not stuck_tasks:
        if args.verbose:
            FeishuChannel.send(
                webhook=webhook,
                title="✅ 卡停巡检正常",
                content=f"共检查 {len(results)} 个任务，未发现卡停问题。",
                extra={"checked": len(results), "status": "all_healthy"},
            )
        summary["notification"] = "skipped_healthy"
    elif args.notify and not webhook:
        summary["notification"] = "skipped_missing_webhook"

    jprint(summary)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="任务卡停检测器 - 主动巡检并自动告警"
    )
    parser.add_argument("--limit", type=int, default=50, help="最多检查多少个最近任务")
    parser.add_argument("--notify", action="store_true", help="发现卡停时推送飞书告警")
    parser.add_argument("--verbose", action="store_true", help="正常时也发送通知")
    parser.add_argument("--auto-recover", action="store_true", help="尝试自动恢复（如添加提醒记录）")
    parser.add_argument("--feishu-webhook", default="", help="覆盖默认飞书 webhook")
    parser.add_argument("--cron", action="store_true", help="定时模式（每15分钟运行一次）")
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.cron:
        print("卡停检测器 - 定时模式启动（每15分钟运行一次）...")
        while True:
            await detect_and_recover(args)
            await asyncio.sleep(15 * 60)  # 15分钟
    else:
        await detect_and_recover(args)


if __name__ == "__main__":
    asyncio.run(main())
