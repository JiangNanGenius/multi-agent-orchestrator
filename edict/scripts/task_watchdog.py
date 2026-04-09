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

from sqlalchemy import select  # noqa: E402

from app.channels.feishu import FeishuChannel  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import async_session  # noqa: E402
from app.models.task import Task  # noqa: E402
from app.services.task_service import TaskService  # noqa: E402


def jprint(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _build_report(item: dict[str, Any]) -> str:
    issues = item.get("issues") or []
    repairs = item.get("repairs") or []
    issue_text = "、".join(issues) if issues else "无"
    repair_text = "、".join(repairs) if repairs else "无"
    return (
        f"**任务代号**：`{item.get('task_code', '')}`\n"
        f"**任务标题**：{item.get('title', '')}\n"
        f"**健康状态**：`{item.get('status', 'unknown')}`\n"
        f"**检测问题**：{issue_text}\n"
        f"**修复动作**：{repair_text}\n"
        f"**建议处理**：{item.get('recommended_action', '') or '无'}"
    )


async def run_watchdog(args: argparse.Namespace) -> None:
    settings = get_settings()
    results: list[dict[str, Any]] = []

    async with async_session() as session:
        svc = TaskService(session, event_bus=None)
        if args.task_id:
            task = await svc.run_watchdog(uuid.UUID(args.task_id), agent=args.agent)
            data = task.to_dict()
            watchdog = ((task.meta or {}).get("workspace") or {}).get("watchdog", {})
            results.append(
                {
                    "task_id": data.get("task_id", ""),
                    "task_code": data.get("taskCode", ""),
                    "title": data.get("title", ""),
                    "status": watchdog.get("status", "unknown"),
                    "issues": watchdog.get("issues", []),
                    "repairs": watchdog.get("repairs", []),
                    "recommended_action": watchdog.get("recommended_action", ""),
                }
            )
        else:
            stmt = select(Task).order_by(Task.updated_at.desc()).limit(args.limit)
            result = await session.execute(stmt)
            tasks = list(result.scalars().all())
            for task in tasks:
                updated = await svc.run_watchdog(task.task_id, agent=args.agent)
                data = updated.to_dict()
                watchdog = ((updated.meta or {}).get("workspace") or {}).get("watchdog", {})
                results.append(
                    {
                        "task_id": data.get("task_id", ""),
                        "task_code": data.get("taskCode", ""),
                        "title": data.get("title", ""),
                        "status": watchdog.get("status", "unknown"),
                        "issues": watchdog.get("issues", []),
                        "repairs": watchdog.get("repairs", []),
                        "recommended_action": watchdog.get("recommended_action", ""),
                    }
                )

    abnormal = [item for item in results if item.get("status") not in {"healthy", "attention"} or item.get("issues")]
    summary = {
        "checked": len(results),
        "abnormal": len(abnormal),
        "items": results,
        "implementation_mode": "script",
        "scheduler_recommendation": "建议通过 cron 或进程守护方式定时运行；当前保留 agent 侧扩展位，但不作为第一落地点。",
        "agent_extension_reserved": True,
    }

    webhook = args.feishu_webhook or settings.workspace_watchdog_feishu_webhook or settings.feishu_report_webhook
    if args.notify and webhook and abnormal:
        content = "\n\n---\n\n".join(_build_report(item) for item in abnormal[:10])
        FeishuChannel.send(
            webhook=webhook,
            title="任务工作区看门狗巡检告警",
            content=content,
            extra={
                "checked": len(results),
                "abnormal": len(abnormal),
                "implementation_mode": "script",
            },
        )
        summary["notification"] = "sent"
    elif args.notify and webhook and not abnormal:
        summary["notification"] = "skipped_no_abnormal"
    elif args.notify and not webhook:
        summary["notification"] = "skipped_missing_webhook"

    jprint(summary)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="任务工作区看门狗巡检脚本（当前默认以独立脚本/定时任务方式运行，保留 agent 扩展位）"
    )
    parser.add_argument("--task-id", default=None, help="仅巡检单个任务")
    parser.add_argument("--limit", type=int, default=30, help="批量巡检时最多检查多少个最近任务")
    parser.add_argument("--agent", default="watchdog", help="巡检记录写入时使用的 agent 名称；默认仍写为 watchdog，便于后续切换到 agent 实现时保持兼容")
    parser.add_argument("--notify", action="store_true", help="发现异常时推送飞书告警")
    parser.add_argument("--feishu-webhook", default="", help="覆盖默认飞书 webhook")
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    await run_watchdog(args)


if __name__ == "__main__":
    asyncio.run(main())
