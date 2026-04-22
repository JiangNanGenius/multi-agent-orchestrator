from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

BASE = "http://127.0.0.1:8000"


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def request(method: str, path: str, data: dict | None = None) -> tuple[int, object]:
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return resp.getcode(), json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = raw
        return exc.code, payload


def main() -> None:
    results: list[CheckResult] = []

    code, health = request("GET", "/health")
    results.append(CheckResult("health", code == 200 and health.get("status") == "ok", f"code={code}, body={health}"))

    code, auth = request("GET", "/api/auth/status")
    auth_ok = code == 200 and auth.get("authenticated") is False and auth.get("username") == "admin"
    results.append(CheckResult("auth_status", auth_ok, f"code={code}, body={auth}"))

    code, config = request("GET", "/api/admin/config")
    config_ok = (
        code == 200
        and str(config.get("database", "")).startswith("sqlite")
        and str(config.get("event_bus", "")).startswith("sqlite")
    )
    results.append(CheckResult("admin_config", config_ok, f"code={code}, database={config.get('database')}, event_bus={config.get('event_bus')}"))

    code, topics = request("GET", "/api/events/topics")
    topic_names = [item.get("name") for item in topics.get("topics", []) if isinstance(item, dict)]
    topics_ok = code == 200 and "task.dispatch" in topic_names
    results.append(CheckResult("event_topics", topics_ok, f"code={code}, topics={topic_names}"))

    code, created = request(
        "POST",
        "/api/tasks",
        {
            "title": "SQLite 完整性检查任务",
            "description": "验证 SQLite 主数据库、事件总线和派发链路。",
            "priority": "高",
            "creator": "integrity-check",
            "tags": ["sqlite", "integrity", "openclaw"],
            "initial_state": "ControlCenter",
        },
    )
    task_id = created.get("task_id") if isinstance(created, dict) else None
    create_ok = code == 201 and bool(task_id)
    results.append(CheckResult("task_create", create_ok, f"code={code}, body={created}"))

    if not task_id:
        print(json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=2))
        raise SystemExit(1)

    code, transition = request(
        "POST",
        f"/api/tasks/{task_id}/transition",
        {"new_state": "PlanCenter", "agent": "integrity-check", "reason": "完整性检查流转"},
    )
    results.append(CheckResult("task_transition", code == 200 and transition.get("state") == "PlanCenter", f"code={code}, body={transition}"))

    code, progress = request(
        "POST",
        f"/api/tasks/{task_id}/progress",
        {"agent": "integrity-check", "content": "已验证任务创建与流转接口可用。"},
    )
    progress_ok = code == 200 and progress.get("message") == "ok"
    results.append(CheckResult("task_progress", progress_ok, f"code={code}, body={progress}"))

    query = urllib.parse.urlencode({"agent": "plan_center", "message": "请回报当前链路状态"})
    code, dispatch = request("POST", f"/api/tasks/{task_id}/dispatch?{query}")
    results.append(CheckResult("task_dispatch_request", code == 200 and dispatch.get("target") == "plan_center", f"code={code}, body={dispatch}"))

    time.sleep(4)

    code, task = request("GET", f"/api/tasks/{task_id}")
    task_ok = code == 200 and task.get("state") in {"PlanCenter", "Blocked", "Assigned", "Doing", "Review"}
    results.append(CheckResult("task_detail_after_dispatch", task_ok, f"code={code}, state={task.get('state')}, flow_len={len(task.get('flow_log', []))}, progress_len={len(task.get('progress_log', []))}"))

    code, stream_info = request("GET", "/api/events/stream-info?topic=task.dispatch")
    results.append(CheckResult("stream_info", code == 200 and stream_info.get("topic") == "task.dispatch", f"code={code}, body={stream_info}"))

    print(json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=2))

    if not all(r.ok for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
