#!/usr/bin/env python3
import json
import pathlib
import datetime
import logging
from file_lock import atomic_json_write, atomic_json_read
from utils import read_json

log = logging.getLogger('refresh')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

BASE = pathlib.Path(__file__).parent.parent
DATA = BASE / 'data'
DEFAULT_HEARTBEAT_SECONDS = 15
DEFAULT_STALE_SECONDS = 45
ACTIVE_STATES = {'Doing', 'Assigned', 'Review', 'Blocked'}
CONTROL_CENTER_ALIAS = {'taizi', 'main'}


def output_meta(path):
    p = pathlib.Path(path)
    if not p.exists():
        return {"exists": False, "lastModified": None}
    ts = datetime.datetime.fromtimestamp(p.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')
    return {"exists": True, "lastModified": ts}


def load_agent_runtime_map():
    agent_cfg = read_json(DATA / 'agent_config.json', {})
    agents = agent_cfg.get('agents', []) if isinstance(agent_cfg, dict) else []
    runtime_map = {}
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        agent_id = str(agent.get('id') or '').strip()
        if not agent_id:
            continue
        runtime_policy = agent.get('runtimePolicy', {}) or {}
        registry = agent.get('registry', {}) or {}
        runtime_map[agent_id] = {
            'id': agent_id,
            'label': agent.get('label', agent_id),
            'role': agent.get('role', ''),
            'group': registry.get('groupLabel') or registry.get('group') or '',
            'workspace': agent.get('workspace', ''),
            'registry': registry,
            'runtimePolicy': runtime_policy,
            'heartbeatSeconds': int(runtime_policy.get('heartbeatSeconds') or DEFAULT_HEARTBEAT_SECONDS),
            'staleAfterSeconds': int(runtime_policy.get('staleAfterSeconds') or DEFAULT_STALE_SECONDS),
            'realtimeTier': runtime_policy.get('realtimeTier', 'standard'),
            'executionMode': runtime_policy.get('executionMode', 'serial'),
            'maxConcurrentTasks': int(runtime_policy.get('maxConcurrentTasks') or 1),
            'systemRepairScope': runtime_policy.get('systemRepairScope', []) or [],
            'directHandleScope': runtime_policy.get('directHandleScope', []) or [],
            'systemRepairOnlyLongRunning': bool(runtime_policy.get('systemRepairOnlyLongRunning', False)),
            'keepRealtimeByDefault': bool(runtime_policy.get('keepRealtimeByDefault', False)),
        }
    return runtime_map


def resolve_runtime_profile(agent_id, runtime_map):
    if agent_id in runtime_map:
        return runtime_map[agent_id]
    if agent_id in CONTROL_CENTER_ALIAS:
        for alias in CONTROL_CENTER_ALIAS:
            if alias in runtime_map:
                return runtime_map[alias]
    return {
        'id': agent_id or '',
        'label': agent_id or '未知Agent',
        'role': '',
        'group': '',
        'workspace': '',
        'registry': {},
        'runtimePolicy': {},
        'heartbeatSeconds': DEFAULT_HEARTBEAT_SECONDS,
        'staleAfterSeconds': DEFAULT_STALE_SECONDS,
        'realtimeTier': 'standard',
        'executionMode': 'serial',
        'maxConcurrentTasks': 1,
        'systemRepairScope': [],
        'directHandleScope': [],
        'systemRepairOnlyLongRunning': False,
        'keepRealtimeByDefault': False,
    }


def parse_updated_at(updated_raw):
    if updated_raw in (None, '', 0):
        return None
    try:
        if isinstance(updated_raw, (int, float)):
            return datetime.datetime.fromtimestamp(updated_raw / 1000, tz=datetime.timezone.utc)
        return datetime.datetime.fromisoformat(str(updated_raw).replace('Z', '+00:00'))
    except Exception:
        return None


def build_heartbeat(age_sec, heartbeat_seconds, stale_after_seconds):
    if age_sec is None:
        return {'status': 'unknown', 'label': '⚪ 未知', 'ageSec': None}
    if age_sec <= heartbeat_seconds:
        return {'status': 'active', 'label': f'🟢 活跃 {int(age_sec)}秒前', 'ageSec': int(age_sec)}
    if age_sec <= stale_after_seconds:
        return {'status': 'warn', 'label': f'🟡 可能停滞 {int(age_sec)}秒前', 'ageSec': int(age_sec)}
    return {'status': 'stalled', 'label': f'🔴 已停滞 {int(age_sec)}秒', 'ageSec': int(age_sec)}


def is_system_repair_task(task, runtime_profile):
    texts = [
        str(task.get('title') or ''),
        str(task.get('now') or ''),
        str(task.get('ac') or ''),
        str(task.get('block') or ''),
    ]
    output_text = str(task.get('output') or '')
    if output_text:
        texts.append(output_text)
    scope = runtime_profile.get('systemRepairScope', []) or []
    if not scope:
        return False
    return any(keyword and keyword in text for keyword in scope for text in texts)


def build_agent_statuses(tasks, runtime_map):
    grouped = {}
    for task in tasks:
        agent_id = task.get('sourceMeta', {}).get('agentId', '')
        if not agent_id:
            continue
        grouped.setdefault(agent_id, []).append(task)

    statuses = []
    for agent_id, profile in runtime_map.items():
        agent_tasks = grouped.get(agent_id, [])
        if not agent_tasks and agent_id in CONTROL_CENTER_ALIAS:
            for alias in CONTROL_CENTER_ALIAS:
                if alias == agent_id:
                    continue
                agent_tasks.extend(grouped.get(alias, []))
        sorted_tasks = sorted(
            agent_tasks,
            key=lambda t: t.get('sourceMeta', {}).get('updatedAt') or 0,
            reverse=True,
        )
        active_tasks = [t for t in sorted_tasks if t.get('state') in ACTIVE_STATES]
        current_tasks = active_tasks[: profile.get('maxConcurrentTasks', 1)]
        queued_tasks = active_tasks[profile.get('maxConcurrentTasks', 1):]
        blocked_tasks = [t for t in sorted_tasks if t.get('state') == 'Blocked']
        heartbeat = None
        for task in current_tasks or sorted_tasks:
            hb = task.get('heartbeat')
            if hb:
                heartbeat = hb
                break
        if heartbeat is None:
            heartbeat = {'status': 'idle', 'label': '⚪ 待命', 'ageSec': None}

        queue_state = 'idle'
        if blocked_tasks:
            queue_state = 'blocked'
        elif current_tasks:
            queue_state = 'running'
        elif queued_tasks:
            queue_state = 'queued'

        statuses.append({
            'agentId': agent_id,
            'label': profile.get('label', agent_id),
            'role': profile.get('role', ''),
            'group': profile.get('group', ''),
            'heartbeat': heartbeat,
            'runtimePolicy': profile.get('runtimePolicy', {}),
            'registry': profile.get('registry', {}),
            'queue': {
                'executionMode': profile.get('executionMode', 'serial'),
                'serialExecution': profile.get('executionMode', 'serial') == 'serial',
                'maxConcurrentTasks': profile.get('maxConcurrentTasks', 1),
                'runningCount': len(current_tasks),
                'queuedCount': len(queued_tasks),
                'blockedCount': len(blocked_tasks),
                'totalActiveCount': len(active_tasks),
                'state': queue_state,
                'currentTaskIds': [t.get('id') for t in current_tasks],
                'queuedTaskIds': [t.get('id') for t in queued_tasks],
                'blockedTaskIds': [t.get('id') for t in blocked_tasks],
            },
            'realtime': {
                'tier': profile.get('realtimeTier', 'standard'),
                'keepRealtimeByDefault': profile.get('keepRealtimeByDefault', False),
                'heartbeatSeconds': profile.get('heartbeatSeconds', DEFAULT_HEARTBEAT_SECONDS),
                'staleAfterSeconds': profile.get('staleAfterSeconds', DEFAULT_STALE_SECONDS),
            },
            'systemRepair': {
                'scope': profile.get('systemRepairScope', []),
                'onlyLongRunning': profile.get('systemRepairOnlyLongRunning', False),
                'activeTaskIds': [t.get('id') for t in current_tasks if t.get('runtime', {}).get('isSystemRepair')],
            },
            'workspace': profile.get('workspace', ''),
        })

    statuses.sort(key=lambda item: (
        0 if item.get('realtime', {}).get('tier') == 'highest' else 1,
        0 if item.get('queue', {}).get('state') == 'running' else 1,
        item.get('label', ''),
    ))
    return statuses


def build_incremental_meta(tasks, previous_payload):
    previous_tasks = {}
    if isinstance(previous_payload, dict):
        for item in previous_payload.get('tasks', []) or []:
            if isinstance(item, dict) and item.get('id'):
                previous_tasks[item['id']] = item

    changed_task_ids = []
    for task in tasks:
        task_id = task.get('id')
        if not task_id:
            continue
        prev = previous_tasks.get(task_id)
        if prev is None:
            changed_task_ids.append(task_id)
            continue
        current_fingerprint = {
            'state': task.get('state'),
            'updatedAt': task.get('sourceMeta', {}).get('updatedAt'),
            'heartbeat': (task.get('heartbeat') or {}).get('status'),
            'queueState': (task.get('runtime') or {}).get('queueState'),
            'now': task.get('now'),
        }
        prev_fingerprint = {
            'state': prev.get('state'),
            'updatedAt': prev.get('sourceMeta', {}).get('updatedAt'),
            'heartbeat': (prev.get('heartbeat') or {}).get('status'),
            'queueState': (prev.get('runtime') or {}).get('queueState'),
            'now': prev.get('now'),
        }
        if current_fingerprint != prev_fingerprint:
            changed_task_ids.append(task_id)

    previous_task_ids = set(previous_tasks.keys())
    current_task_ids = {t.get('id') for t in tasks if t.get('id')}
    removed_task_ids = sorted(previous_task_ids - current_task_ids)
    return {
        'changedTaskIds': changed_task_ids[:100],
        'changedTaskCount': len(changed_task_ids),
        'removedTaskIds': removed_task_ids[:100],
        'removedTaskCount': len(removed_task_ids),
        'fullRebuild': False,
    }


def main():
    officials_data = read_json(DATA / 'officials_stats.json', {})
    officials = officials_data.get('officials', []) if isinstance(officials_data, dict) else officials_data
    tasks = atomic_json_read(DATA / 'tasks_source.json', [])
    if not tasks:
        tasks = read_json(DATA / 'tasks.json', [])

    sync_status = read_json(DATA / 'sync_status.json', {})
    previous_payload = atomic_json_read(DATA / 'live_status.json', {})
    runtime_map = load_agent_runtime_map()

    org_map = {}
    for o in officials:
        label = o.get('label', o.get('name', ''))
        if label:
            org_map[label] = label

    now_ts = datetime.datetime.now(datetime.timezone.utc)
    per_agent_active_index = {}
    sorted_for_queue = sorted(
        tasks,
        key=lambda item: item.get('sourceMeta', {}).get('updatedAt') or 0,
        reverse=True,
    )
    for task in sorted_for_queue:
        agent_id = task.get('sourceMeta', {}).get('agentId', '')
        if not agent_id or task.get('state') not in ACTIVE_STATES:
            continue
        per_agent_active_index.setdefault(agent_id, []).append(task.get('id'))

    for t in tasks:
        t['org'] = t.get('org') or org_map.get(t.get('official', ''), '')
        t['outputMeta'] = output_meta(t.get('output', ''))

        agent_id = t.get('sourceMeta', {}).get('agentId', '')
        profile = resolve_runtime_profile(agent_id, runtime_map)
        updated_raw = t.get('updatedAt') or t.get('sourceMeta', {}).get('updatedAt')
        age_sec = None
        updated_dt = parse_updated_at(updated_raw)
        if updated_dt is not None:
            age_sec = (now_ts - updated_dt).total_seconds()

        if t.get('state') in ('Doing', 'Assigned', 'Review', 'Blocked'):
            t['heartbeat'] = build_heartbeat(age_sec, profile.get('heartbeatSeconds', DEFAULT_HEARTBEAT_SECONDS), profile.get('staleAfterSeconds', DEFAULT_STALE_SECONDS))
        else:
            t['heartbeat'] = None

        agent_queue = per_agent_active_index.get(agent_id, [])
        queue_position = agent_queue.index(t.get('id')) + 1 if t.get('id') in agent_queue else None
        is_system_repair = is_system_repair_task(t, profile)
        t['runtime'] = {
            'agentId': agent_id,
            'agentLabel': profile.get('label', agent_id),
            'group': profile.get('group', ''),
            'realtimeTier': profile.get('realtimeTier', 'standard'),
            'serialExecution': profile.get('executionMode', 'serial') == 'serial',
            'maxConcurrentTasks': profile.get('maxConcurrentTasks', 1),
            'queuePosition': queue_position,
            'queueState': 'running' if queue_position == 1 else ('queued' if queue_position and queue_position > 1 else 'idle'),
            'isSystemRepair': is_system_repair,
            'allowLongRunningExecution': bool(profile.get('runtimePolicy', {}).get('allowLongRunningExecution', False)),
            'keepRealtimeByDefault': bool(profile.get('keepRealtimeByDefault', False)),
            'heartbeatSeconds': profile.get('heartbeatSeconds', DEFAULT_HEARTBEAT_SECONDS),
            'staleAfterSeconds': profile.get('staleAfterSeconds', DEFAULT_STALE_SECONDS),
        }

    today_str = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

    def _is_today_done(task):
        if task.get('state') != 'Done':
            return False
        ua = task.get('updatedAt', '')
        if isinstance(ua, str) and ua[:10] == today_str:
            return True
        lm = task.get('outputMeta', {}).get('lastModified', '')
        if isinstance(lm, str) and lm[:10] == today_str:
            return True
        return False

    today_done = sum(1 for t in tasks if _is_today_done(t))
    total_done = sum(1 for t in tasks if t.get('state') == 'Done')
    in_progress = sum(1 for t in tasks if t.get('state') in ['Doing', 'Review', 'Next', 'Blocked'])
    blocked = sum(1 for t in tasks if t.get('state') == 'Blocked')

    history = []
    for t in tasks:
        if t.get('state') == 'Done':
            lm = t.get('outputMeta', {}).get('lastModified')
            history.append({
                'at': lm or '未知',
                'official': t.get('official'),
                'task': t.get('title'),
                'out': t.get('output'),
                'qa': '通过' if t.get('outputMeta', {}).get('exists') else '待补成果'
            })

    agent_statuses = build_agent_statuses(tasks, runtime_map)
    incremental = build_incremental_meta(tasks, previous_payload)

    payload = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'taskSource': 'tasks_source.json' if (DATA / 'tasks_source.json').exists() else 'tasks.json',
        'officials': officials,
        'tasks': tasks,
        'history': history,
        'metrics': {
            'officialCount': len(officials),
            'todayDone': today_done,
            'totalDone': total_done,
            'inProgress': in_progress,
            'blocked': blocked
        },
        'syncStatus': sync_status,
        'health': {
            'syncOk': bool(sync_status.get('ok', False)),
            'syncLatencyMs': sync_status.get('durationMs'),
            'missingFieldCount': len(sync_status.get('missingFields', {})),
        },
        'agentStatuses': agent_statuses,
        'runtimeSummary': {
            'serialExecutionModel': 'single-agent-single-task',
            'highestRealtimeAgentIds': [item.get('agentId') for item in agent_statuses if item.get('realtime', {}).get('tier') == 'highest'],
            'systemRepairScope': runtime_map.get('taizi', runtime_map.get('main', {})).get('systemRepairScope', []),
        },
        'incremental': incremental,
    }

    atomic_json_write(DATA / 'live_status.json', payload)
    log.info(f'updated live_status.json ({len(tasks)} tasks, {len(agent_statuses)} agent statuses)')


if __name__ == '__main__':
    main()
