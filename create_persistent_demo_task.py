from __future__ import annotations

import json
from pathlib import Path

from dashboard import server

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'review_notes' / 'demo_task_latest.json'


def main() -> None:
    create = server.handle_create_task(
        title='示例任务：验证持久化聊天会话窗口与刷新恢复',
        org='总控中心',
        owner='演示助手',
        priority='normal',
        template_id='skills_config_dialog',
        params={
            'entry': 'demo-board',
            'message': '这是一个用于演示任务看板的示例任务。重点观察任务创建后如何保留活动流，以及刷新页面后如何恢复查看记录。',
            'confirmationSummary': '目标：展示技能管理员会话式任务如何进入后台执行，并支持刷新恢复。',
            'targetAgentId': 'admin_specialist',
            'targetAgentLabel': '技能管理员',
        },
        target_dept='技能管理员',
    )
    task_id = create.get('taskId', '')
    if not task_id:
        raise SystemExit(json.dumps(create, ensure_ascii=False))

    append_results = [
        server.handle_task_append_message(
            task_id,
            'admin_specialist',
            '第一条演示补充：该任务用于展示左侧会话列表、任务活动流与后台继续执行的关系。',
        ),
        server.handle_task_append_message(
            task_id,
            'admin_specialist',
            '第二条演示补充：刷新网页后，仍可通过 taskId 恢复这条任务会话。',
        ),
    ]
    activity = server.get_task_activity(task_id)
    payload = {
        'create': create,
        'append': append_results,
        'activity_count': len(activity.get('activity') or []),
        'task_meta': activity.get('taskMeta') or {},
        'latest_activity': (activity.get('activity') or [])[-5:],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
