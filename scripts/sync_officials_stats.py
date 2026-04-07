#!/usr/bin/env python3
"""同步各 Agent 统计数据 → data/officials_stats.json"""
import json
import pathlib
import datetime
import logging
from file_lock import atomic_json_write

log = logging.getLogger('officials')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

BASE = pathlib.Path(__file__).resolve().parent.parent
DATA = BASE / 'data'
AGENTS_ROOT = pathlib.Path.home() / '.openclaw' / 'agents'
OPENCLAW_CFG = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
AGENT_CONFIG = DATA / 'agent_config.json'

# Anthropic 定价（每1M token，美元）
MODEL_PRICING = {
    'anthropic/claude-sonnet-4-6':  {'in':3.0, 'out':15.0, 'cr':0.30, 'cw':3.75},
    'anthropic/claude-opus-4-5':    {'in':15.0,'out':75.0, 'cr':1.50, 'cw':18.75},
    'anthropic/claude-haiku-3-5':   {'in':0.8, 'out':4.0,  'cr':0.08, 'cw':1.0},
    'openai/gpt-4o':                {'in':2.5, 'out':10.0, 'cr':1.25, 'cw':0},
    'openai/gpt-4o-mini':           {'in':0.15,'out':0.6,  'cr':0.075,'cw':0},
    'google/gemini-2.0-flash':      {'in':0.075,'out':0.3, 'cr':0,    'cw':0},
    'google/gemini-2.5-pro':        {'in':1.25,'out':10.0, 'cr':0,    'cw':0},
}

LEGACY_OFFICIALS = [
    {'id':'taizi',   'label':'总控中心',     'role':'总控专家',     'group':'总控中心',   'rank':'核心枢纽'},
    {'id':'zhongshu','label':'规划中心',     'role':'规划专家',     'group':'流程中枢',   'rank':'核心节点'},
    {'id':'menxia',  'label':'评审中心',     'role':'评审专家',     'group':'流程中枢',   'rank':'核心节点'},
    {'id':'shangshu','label':'调度中心',     'role':'调度专家',     'group':'流程中枢',   'rank':'核心节点'},
    {'id':'libu',    'label':'文案专家',     'role':'文案专家',     'group':'专业执行组', 'rank':'专业专家'},
    {'id':'hubu',    'label':'数据专家',     'role':'数据专家',     'group':'专业执行组', 'rank':'专业专家'},
    {'id':'bingbu',  'label':'代码专家',     'role':'代码专家',     'group':'专业执行组', 'rank':'专业专家'},
    {'id':'xingbu',  'label':'合规专家',     'role':'合规专家',     'group':'专业执行组', 'rank':'专业专家'},
    {'id':'gongbu',  'label':'部署专家',     'role':'部署专家',     'group':'专业执行组', 'rank':'专业专家'},
    {'id':'libu_hr', 'label':'Agent管理专家','role':'Agent管理专家','group':'专业执行组', 'rank':'专业专家'},
    {'id':'zaochao', 'label':'晨报中心',     'role':'晨报专家',     'group':'支持中心',   'rank':'支持节点'},
]

CONTROL_CENTER_ALIAS = {'taizi', 'main'}
_OPENCLAW_CACHE = None


def rj(p, d):
    try:
        return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    except Exception:
        return d


def _load_openclaw_cfg():
    global _OPENCLAW_CACHE
    if _OPENCLAW_CACHE is None:
        _OPENCLAW_CACHE = rj(OPENCLAW_CFG, {})
    return _OPENCLAW_CACHE


def normalize_model(model_value, fallback='anthropic/claude-sonnet-4-6'):
    if isinstance(model_value, str) and model_value:
        return model_value
    if isinstance(model_value, dict):
        return model_value.get('primary') or model_value.get('id') or fallback
    return fallback


def get_model(agent_id):
    cfg = _load_openclaw_cfg()
    default = normalize_model(cfg.get('agents', {}).get('defaults', {}).get('model', {}), 'anthropic/claude-sonnet-4-6')
    for a in cfg.get('agents', {}).get('list', []):
        if a.get('id') == agent_id:
            return normalize_model(a.get('model', default), default)
    if agent_id == 'taizi':
        for a in cfg.get('agents', {}).get('list', []):
            if a.get('id') == 'main':
                return normalize_model(a.get('model', default), default)
    return default


def load_agent_profiles():
    cfg = rj(AGENT_CONFIG, {})
    agents = cfg.get('agents', []) if isinstance(cfg, dict) else []
    profiles = []
    seen = set()
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        agent_id = str(agent.get('id') or '').strip()
        if not agent_id:
            continue
        canonical_id = 'taizi' if agent_id in CONTROL_CENTER_ALIAS else agent_id
        if canonical_id in seen:
            continue
        seen.add(canonical_id)
        registry = agent.get('registry', {}) or {}
        label = agent.get('label') or registry.get('groupLabel') or canonical_id
        role = agent.get('role') or label
        group = registry.get('groupLabel') or registry.get('group') or '专业执行组'
        rank = '核心枢纽' if registry.get('isControlCenter') else ('专业专家' if registry.get('isExpert') else '协作节点')
        profiles.append({
            'id': canonical_id,
            'label': label,
            'role': role,
            'group': group,
            'rank': rank,
            'registry': registry,
            'workspace': agent.get('workspace', ''),
        })

    if not profiles:
        profiles = LEGACY_OFFICIALS

    profiles.sort(key=lambda item: (0 if item['id'] == 'taizi' else 1, item['group'], item['label']))
    return profiles


def scan_agent(agent_id):
    session_roots = [agent_id]
    if agent_id == 'taizi':
        session_roots = ['taizi', 'main']

    tin = tout = cr = cw = 0
    last_ts = None
    total_sessions = 0
    msg_count = 0

    for root_id in session_roots:
        sj = AGENTS_ROOT / root_id / 'sessions' / 'sessions.json'
        if not sj.exists():
            continue

        data = rj(sj, {})
        total_sessions += len(data)
        for _, v in data.items():
            tin += v.get('inputTokens', 0) or 0
            tout += v.get('outputTokens', 0) or 0
            cr  += v.get('cacheRead', 0) or 0
            cw  += v.get('cacheWrite', 0) or 0
            ts = v.get('updatedAt')
            if ts:
                try:
                    t = datetime.datetime.fromtimestamp(ts/1000) if isinstance(ts, int) else datetime.datetime.fromisoformat(ts.replace('Z','+00:00'))
                    if last_ts is None or t > last_ts:
                        last_ts = t
                except Exception:
                    pass

        if data:
            try:
                sf_key = max(data.keys(), key=lambda k: data[k].get('updatedAt', 0) or 0, default=None)
            except Exception:
                sf_key = None
        else:
            sf_key = None

        if sf_key and data[sf_key].get('sessionFile'):
            sf = AGENTS_ROOT / root_id / 'sessions' / pathlib.Path(data[sf_key]['sessionFile']).name
            try:
                lines = sf.read_text(errors='ignore').splitlines()
                for ln in lines:
                    try:
                        e = json.loads(ln)
                        if e.get('type') == 'message' and e.get('message', {}).get('role') == 'assistant':
                            msg_count += 1
                    except Exception:
                        pass
            except Exception:
                pass

    return {
        'tokens_in': tin,
        'tokens_out': tout,
        'cache_read': cr,
        'cache_write': cw,
        'sessions': total_sessions,
        'last_active': last_ts.strftime('%Y-%m-%d %H:%M') if last_ts else None,
        'messages': msg_count,
    }


def calc_cost(s, model):
    p = MODEL_PRICING.get(model, MODEL_PRICING['anthropic/claude-sonnet-4-6'])
    usd = (s['tokens_in']/1e6*p['in'] + s['tokens_out']/1e6*p['out']
         + s['cache_read']/1e6*p['cr'] + s['cache_write']/1e6*p['cw'])
    return round(usd, 4)


def matches_agent(task, agent_id):
    source_agent_id = str(task.get('sourceMeta', {}).get('agentId') or '')
    if agent_id == 'taizi':
        return source_agent_id in CONTROL_CENTER_ALIAS
    return source_agent_id == agent_id


def get_task_stats(agent_id, tasks):
    relevant = [t for t in tasks if matches_agent(t, agent_id)]
    done = [t for t in relevant if t.get('state') == 'Done']
    active = [t for t in relevant if t.get('state') in ('Doing', 'Review', 'Assigned', 'Blocked')]
    participated = [{'id': t.get('id', ''), 'title': t.get('title', ''), 'state': t.get('state', '')} for t in relevant if str(t.get('id', '')).startswith('JJC')]
    flow_logs = sum(len(t.get('flow_log', []) or []) for t in relevant)
    blocked = sum(1 for t in relevant if t.get('state') == 'Blocked')
    return {
        'tasks_done': len(done),
        'tasks_active': len(active),
        'tasks_blocked': blocked,
        'flow_participations': flow_logs,
        'participated_edicts': participated,
    }


def get_agent_live(agent_id, live):
    live_tasks = live.get('tasks', []) if isinstance(live, dict) else []
    for item in live.get('agentStatuses', []) if isinstance(live, dict) else []:
        current_id = item.get('agentId')
        if agent_id == 'taizi' and current_id in CONTROL_CENTER_ALIAS:
            return item
        if current_id == agent_id:
            return item

    heartbeat = {'status':'idle','label':'⚪ 待命','ageSec':None}
    for t in live_tasks:
        if matches_agent(t, agent_id) and t.get('heartbeat'):
            heartbeat = t['heartbeat']
            break

    return {
        'agentId': agent_id,
        'heartbeat': heartbeat,
        'queue': {
            'executionMode': 'serial',
            'serialExecution': True,
            'maxConcurrentTasks': 1,
            'runningCount': 0,
            'queuedCount': 0,
            'blockedCount': 0,
            'totalActiveCount': 0,
            'state': 'idle',
            'currentTaskIds': [],
            'queuedTaskIds': [],
            'blockedTaskIds': [],
        },
        'realtime': {
            'tier': 'highest' if agent_id == 'taizi' else 'standard',
            'keepRealtimeByDefault': agent_id == 'taizi',
            'heartbeatSeconds': 15,
            'staleAfterSeconds': 45,
        },
        'systemRepair': {
            'scope': [],
            'onlyLongRunning': agent_id == 'taizi',
            'activeTaskIds': [],
        },
        'runtimePolicy': {
            'executionMode': 'serial',
            'maxConcurrentTasks': 1,
        },
        'registry': {},
    }


def main():
    profiles = load_agent_profiles()
    tasks = rj(DATA / 'tasks_source.json', [])
    live = rj(DATA / 'live_status.json', {})

    result = []
    for profile in profiles:
        agent_id = profile['id']
        model = get_model(agent_id)
        session_stats = scan_agent(agent_id)
        task_stats = get_task_stats(agent_id, tasks)
        live_info = get_agent_live(agent_id, live)
        cost_usd = calc_cost(session_stats, model)

        queue = live_info.get('queue', {}) or {}
        realtime = live_info.get('realtime', {}) or {}
        system_repair = live_info.get('systemRepair', {}) or {}

        result.append({
            'id': agent_id,
            'label': profile['label'],
            'role': profile['role'],
            'group': profile.get('group', ''),
            'rank': profile.get('rank', ''),
            'model': model,
            'model_short': model.split('/')[-1] if isinstance(model, str) and '/' in model else str(model),
            'sessions': session_stats['sessions'],
            'tokens_in': session_stats['tokens_in'],
            'tokens_out': session_stats['tokens_out'],
            'cache_read': session_stats['cache_read'],
            'cache_write': session_stats['cache_write'],
            'tokens_total': session_stats['tokens_in'] + session_stats['tokens_out'],
            'messages': session_stats['messages'],
            'cost_usd': cost_usd,
            'cost_cny': round(cost_usd * 7.25, 2),
            'last_active': session_stats['last_active'],
            'heartbeat': live_info.get('heartbeat', {'status':'idle','label':'⚪ 待命','ageSec':None}),
            'tasks_done': task_stats['tasks_done'],
            'tasks_active': task_stats['tasks_active'],
            'tasks_blocked': task_stats['tasks_blocked'],
            'flow_participations': task_stats['flow_participations'],
            'participated_edicts': task_stats['participated_edicts'],
            'queue': queue,
            'realtime': realtime,
            'systemRepair': system_repair,
            'runtimePolicy': live_info.get('runtimePolicy', {}),
            'registry': live_info.get('registry', profile.get('registry', {})),
            'workspace': profile.get('workspace', ''),
            'merit_score': task_stats['tasks_done'] * 10 + task_stats['flow_participations'] * 2 + min(session_stats['sessions'], 20),
        })

    result.sort(key=lambda x: (
        0 if x.get('realtime', {}).get('tier') == 'highest' else 1,
        -x['merit_score'],
        x['label'],
    ))
    for i, r in enumerate(result):
        r['merit_rank'] = i + 1

    totals = {
        'tokens_total': sum(r['tokens_total'] for r in result),
        'cache_total': sum(r['cache_read'] + r['cache_write'] for r in result),
        'cost_usd': round(sum(r['cost_usd'] for r in result), 2),
        'cost_cny': round(sum(r['cost_cny'] for r in result), 2),
        'tasks_done': sum(r['tasks_done'] for r in result),
        'tasks_active': sum(r['tasks_active'] for r in result),
        'blocked': sum(r['tasks_blocked'] for r in result),
    }
    top = max(result, key=lambda x: x['merit_score'], default={})

    payload = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'productName': '多Agent智作中枢',
        'officials': result,
        'totals': totals,
        'top_official': top.get('label', ''),
        'runtimeSummary': live.get('runtimeSummary', {}),
    }
    atomic_json_write(DATA / 'officials_stats.json', payload)
    log.info(f'{len(result)} agents | cost=¥{totals["cost_cny"]} | top={top.get("label","")}')


if __name__ == '__main__':
    main()
