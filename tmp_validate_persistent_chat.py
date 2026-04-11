from __future__ import annotations

import copy
import json
from pathlib import Path

from dashboard import server

ROOT = Path(__file__).resolve().parent
TASKS_FILE = ROOT / 'data' / 'tasks_source.json'


def main() -> None:
    original = json.loads(TASKS_FILE.read_text(encoding='utf-8')) if TASKS_FILE.exists() else []
    created_task_id = None
    try:
        result = server.handle_create_task(
            title='请技能管理员处理：验证持久化聊天会话刷新恢复链路',
            org='总控中心',
            owner='自动化验证脚本',
            priority='normal',
            template_id='skills_config_dialog',
            params={
                'entry': 'skills-config',
                'message': '验证脚本创建的临时任务，用于检查草稿确认后是否能绑定 taskId 并恢复活动流。',
                'targetAgentId': 'admin_specialist',
                'targetAgentLabel': '技能管理员',
            },
            target_dept='技能管理员',
        )
        if not result.get('ok') or not result.get('taskId'):
            raise RuntimeError(f'create failed: {result}')
        created_task_id = result['taskId']

        append_result = server.handle_task_append_message(
            created_task_id,
            'admin_specialist',
            '这是验证脚本追加的续聊消息，用于检查刷新后是否还能从活动流恢复。',
        )
        if not append_result.get('ok'):
            raise RuntimeError(f'append failed: {append_result}')

        activity_result = server.get_task_activity(created_task_id)
        if not activity_result.get('ok'):
            raise RuntimeError(f'activity failed: {activity_result}')

        activity = activity_result.get('activity') or []
        texts = [
            item.get('text') or item.get('remark') or item.get('message') or ''
            for item in activity
        ]
        assert any('提交任务' in t for t in texts), 'missing create flow log'
        assert any('用户追加说明' in t for t in texts), 'missing appended message in activity stream'
        assert activity_result.get('taskMeta', {}).get('title'), 'missing task meta title'

        print(json.dumps({
            'ok': True,
            'taskId': created_task_id,
            'appendMessage': append_result.get('message', ''),
            'activityCount': len(activity),
            'latestActivity': texts[-3:],
        }, ensure_ascii=False, indent=2))
    finally:
        TASKS_FILE.write_text(json.dumps(original, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        try:
            server.save_tasks(copy.deepcopy(original))
        except Exception:
            pass


if __name__ == '__main__':
    main()
