from __future__ import annotations

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

from app.channels.feishu import FeishuChannel  # noqa: E402
from app.db import async_session  # noqa: E402
from app.models.task import Task, TaskState  # noqa: E402
from app.services.task_service import TaskService  # noqa: E402
from app.services.task_workspace import TASK_WORKSPACE_INDEX_DIR  # noqa: E402
from sqlalchemy import select  # noqa: E402


TEST_TITLE = "E2E 联调验证任务"
TEST_DESCRIPTION = "用于验证创建、进度、Todo、状态流转、归档、回迁、看门狗与账本索引链路。"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


async def _latest_task_by_title(session, title: str) -> Task | None:
    stmt = select(Task).where(Task.title == title).order_by(Task.created_at.desc()).limit(1)
    result = await session.execute(stmt)
    return result.scalars().first()


async def main() -> None:
    summary: dict[str, Any] = {
        "checks": [],
        "task_id": "",
        "task_code": "",
        "workspace": {},
        "indices": {},
        "ledger_files": {},
        "watchdog": {},
        "final_state": {},
    }

    async with async_session() as session:
        svc = TaskService(session, event_bus=None)
        original_feishu_send = FeishuChannel.send
        original_should_send = svc._should_send_feishu_report
        FeishuChannel.send = staticmethod(lambda webhook, title, content, url=None, reply_meta=None, extra=None: True)
        svc._should_send_feishu_report = lambda *, event, agent: (
            True,
            {
                "enabled": True,
                "channel": "feishu",
                "webhook_configured": True,
                "allowed_agents": [],
                "allowed_events": [],
                "skip_reason": "",
            },
        )

        task = await svc.create_task(
            title=TEST_TITLE,
            description=TEST_DESCRIPTION,
            priority="高",
            creator="manus",
            initial_state=TaskState.ControlCenter,
            meta={"project_size_gb_estimate": 2},
        )
        task_id = task.task_id
        summary["task_id"] = str(task_id)
        data = task.to_dict()
        summary["task_code"] = data.get("taskCode", "")
        summary["checks"].append({"name": "create_task", "ok": bool(data.get("workspacePath"))})

        task = await svc.add_progress(task_id, agent="manus", content="完成联调脚本创建后的第一条进度写入。")
        task = await svc.update_todos(
            task_id,
            [
                {"text": "验证归档回迁链路", "done": False, "status": "open"},
                {"text": "验证看门狗巡检链路", "done": False, "status": "open"},
            ],
        )
        task = await svc.transition_state(
            task_id,
            new_state=TaskState.PlanCenter,
            agent="manus",
            reason="进入规划阶段，验证状态流转与账本回写。",
        )
        summary["checks"].append({"name": "progress_todos_transition", "ok": task.state == TaskState.PlanCenter})

        task = await svc.archive_workspace(task_id, agent="manus")
        archived = task.to_dict()
        archived_workspace = archived.get("meta", {}).get("workspace", {})
        summary["checks"].append(
            {
                "name": "archive_workspace",
                "ok": archived.get("workspaceArchiveStatus") == "cold"
                and archived.get("workspaceProcessingLocation") == "cold",
            }
        )

        task = await svc.reactivate_workspace(task_id, agent="manus", move_to_hot=True)
        reactivated = task.to_dict()
        summary["checks"].append(
            {
                "name": "reactivate_workspace",
                "ok": reactivated.get("workspaceArchiveStatus") == "hot"
                and reactivated.get("workspaceProcessingLocation") == "hot",
            }
        )

        task = await svc.run_watchdog(task_id, agent="watchdog")
        data = task.to_dict()
        workspace = (task.meta or {}).get("workspace", {})
        watchdog = workspace.get("watchdog", {})
        summary["watchdog"] = watchdog
        summary["checks"].append(
            {
                "name": "watchdog",
                "ok": watchdog.get("status") in {"healthy", "repaired", "attention", "repairing"},
            }
        )

        todo_path = Path(data.get("workspaceTodoPath", ""))
        if todo_path.exists():
            todo_path.unlink()
        task = await svc.run_watchdog(task_id, agent="watchdog")
        repaired_workspace = (task.meta or {}).get("workspace", {})
        repaired_watchdog = repaired_workspace.get("watchdog", {})
        summary["checks"].append(
            {
                "name": "watchdog_repair",
                "ok": todo_path.exists()
                and (
                    bool(repaired_watchdog.get("repairs"))
                    or repaired_watchdog.get("status") in {"healthy", "attention", "repairing"}
                ),
            }
        )

        meta = dict(task.meta or {})
        meta["context_window"] = {"status": "critical", "source": "e2e_validation"}
        task.meta = meta
        await session.commit()
        task = await svc.add_progress(task_id, agent="manus", content="补写高压力上下文验证记录，以触发 /new 建议。")
        data = task.to_dict()
        summary["checks"].append(
            {
                "name": "new_refresh_rule",
                "ok": bool(data.get("workspaceRefreshRecommended"))
                and bool((data.get("workspaceNewRefresh") or {}).get("should_refresh"))
                and (data.get("workspaceNewRefresh") or {}).get("severity") in {"recommended", "required"},
            }
        )

        summary["workspace"] = {
            "workspace_path": data.get("workspacePath", ""),
            "workspace_actual_path": data.get("workspaceActualPath", ""),
            "workspace_archive_status": data.get("workspaceArchiveStatus", ""),
            "workspace_processing_location": data.get("workspaceProcessingLocation", ""),
            "workspace_refresh_recommended": data.get("workspaceRefreshRecommended", False),
            "workspace_new_refresh": data.get("workspaceNewRefresh", {}),
            "workspace_feishu_reporting": data.get("workspaceFeishuReporting", {}),
            "workspace_resume_export_path": data.get("workspaceResumeExportPath", ""),
            "workspace_latest_context_path": data.get("workspaceLatestContextPath", ""),
        }

        workspace_path = Path(data.get("workspacePath", ""))
        workspace_actual_path = Path(data.get("workspaceActualPath", ""))
        summary["ledger_files"] = {
            "logical_exists": workspace_path.exists(),
            "actual_exists": workspace_actual_path.exists(),
            "readme_exists": Path(data.get("workspaceReadmePath", "")).exists(),
            "todo_exists": Path(data.get("workspaceTodoPath", "")).exists(),
            "task_record_exists": Path(data.get("workspaceTaskRecordPath", "")).exists(),
            "handoff_exists": Path(data.get("workspaceHandoffPath", "")).exists(),
            "status_exists": Path(data.get("workspaceStatusPath", "")).exists(),
            "resume_export_exists": Path(data.get("workspaceResumeExportPath", "")).exists(),
            "latest_context_exists": Path(data.get("workspaceLatestContextPath", "")).exists(),
            "reports_ledger_exists": Path(workspace.get("reports_ledger_path", "")).exists(),
            "ledger_dir_exists": Path(workspace.get("ledger_dir", "")).exists(),
            "agent_notes_dir_exists": Path(workspace.get("agent_notes_dir", "")).exists(),
        }
        summary["checks"].append(
            {
                "name": "workspace_files",
                "ok": all(summary["ledger_files"].values()),
            }
        )

        task_index = _load_json(TASK_WORKSPACE_INDEX_DIR / "task_index.json")
        archive_index = _load_json(TASK_WORKSPACE_INDEX_DIR / "archive_index.json")
        by_task_id = task_index.get("by_task_id", {}).get(str(task_id), {})
        archive_by_task = archive_index.get("by_task_id", {}).get(str(task_id), {})
        summary["indices"] = {
            "task_index_found": bool(by_task_id),
            "archive_index_found": bool(archive_by_task),
            "task_index_archive_status": by_task_id.get("archive_status", ""),
            "task_index_processing_location": by_task_id.get("processing_location", ""),
            "task_index_watchdog_status": by_task_id.get("watchdog_status", ""),
            "task_index_refresh_recommended": by_task_id.get("refresh_recommended"),
            "task_index_new_refresh": by_task_id.get("new_refresh", {}),
            "archive_index_last_known_cold_archive_path": archive_by_task.get("last_known_cold_archive_path", ""),
            "archive_index_currently_cold": archive_by_task.get("currently_cold"),
        }
        summary["checks"].append(
            {
                "name": "task_index",
                "ok": bool(by_task_id)
                and by_task_id.get("archive_status") == "hot"
                and by_task_id.get("processing_location") == "hot",
            }
        )
        summary["checks"].append(
            {
                "name": "archive_index",
                "ok": bool(archive_by_task) and bool(archive_by_task.get("last_known_cold_archive_path", "")),
            }
        )
        summary["checks"].append(
            {
                "name": "feishu_reporting",
                "ok": (data.get("workspaceFeishuReporting") or {}).get("last_status") == "sent"
                and Path(workspace.get("reports_ledger_path", "")).exists(),
            }
        )
        summary["checks"].append(
            {
                "name": "index_consistency",
                "ok": by_task_id.get("task_code") == data.get("taskCode", "")
                and by_task_id.get("archive_status") == data.get("workspaceArchiveStatus", "")
                and by_task_id.get("watchdog_status") == ((data.get("workspaceWatchdog") or {}).get("status", "")),
            }
        )

        latest = await _latest_task_by_title(session, TEST_TITLE)
        latest_dict = latest.to_dict() if latest else {}
        summary["final_state"] = {
            "state": latest_dict.get("state", ""),
            "archived": latest_dict.get("archived"),
            "task_policy": latest_dict.get("workspaceTaskPolicy", {}),
            "new_refresh": latest_dict.get("workspaceNewRefresh", {}),
            "watchdog": latest_dict.get("workspaceWatchdog", {}),
            "feishu_reporting": latest_dict.get("workspaceFeishuReporting", {}),
        }

        FeishuChannel.send = original_feishu_send
        svc._should_send_feishu_report = original_should_send

    summary["all_passed"] = all(bool(item.get("ok")) for item in summary["checks"])
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
