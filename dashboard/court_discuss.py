"""
协同讨论引擎 —— 支持正式会议与闲聊的多专家协作系统。

核心能力：
1. 自动识别正式会议 / 闲聊模式
2. 正式会议由主持人控场，并指定专家发言
3. 支持会议阶段推进、会议纪要与可追溯记录
4. 闲聊模式保留更自然的多人交流体验
"""
from __future__ import annotations

import json
import logging
import os
import random
import time
import uuid
from typing import Any

logger = logging.getLogger('collab_discuss')


AGENT_PROFILES = {
    'control_center': {
        'name': '总控中心', 'emoji': '🎛️', 'role': '入口总控',
        'duty': '负责全局统筹、议程把握、优先级判断和关键取舍，适合担任会议主持人或最终拍板者。',
        'personality': '年轻有为、锐意进取，偶尔冲动但善于学习。说话干脆利落，喜欢用现代化的比喻。',
        'speaking_style': '简洁有力，经常用“我建议”开头，偶尔蹦出网络用语。'
    },
    'plan_center': {
        'name': '规划中心', 'emoji': '🧭', 'role': '任务规划',
        'duty': '负责方案规划、议程设计、阶段拆解与目标澄清，适合做会议框架搭建和方案主持。',
        'personality': '老成持重，擅长规划，总能提出系统性方案。话多但有条理。',
        'speaking_style': '喜欢列点论述，常说“我建议从三个方面考量”。'
    },
    'review_center': {
        'name': '评审中心', 'emoji': '🔍', 'role': '质量评审',
        'duty': '负责风险识别、可行性审核、质量把关和反向追问，适合担任审议型主持人。',
        'personality': '严谨挑剔，眼光犀利，善于找漏洞。是天生的审查官，但也很公正。',
        'speaking_style': '喜欢反问，常以“这里有三点疑虑”切入。对不完善的方案会直言不讳。'
    },
    'dispatch_center': {
        'name': '调度中心', 'emoji': '📮', 'role': '调度协调',
        'duty': '负责任务分工、执行编排、协作节奏控制和行动项落地追踪。',
        'personality': '执行力强，务实干练，关注可行性和资源分配。',
        'speaking_style': '直来直去，常说“我来安排”或“交由对应专家办理”。重效率轻虚文。'
    },
    'docs_specialist': {
        'name': '文案专家', 'emoji': '📝', 'role': '内容文档专家',
        'duty': '负责文档、公告、用户说明、会议纪要润色与规范表达。',
        'personality': '文采飞扬，注重规范和形式，擅长文档和汇报。有点强迫症。',
        'speaking_style': '措辞优美，喜欢用排比和对仗，表达克制而准确。'
    },
    'data_specialist': {
        'name': '数据专家', 'emoji': '💰', 'role': '数据资源专家',
        'duty': '负责数据、成本、指标、资源测算与量化论证。',
        'personality': '精打细算，对预算和资源极其敏感。总想省钱但也识大局。',
        'speaking_style': '言必及成本，经常边说边算账。'
    },
    'code_specialist': {
        'name': '代码专家', 'emoji': '⚔️', 'role': '工程实现专家',
        'duty': '负责技术实现、系统设计、接口方案、代码落地和工程风险处理。',
        'personality': '雷厉风行，危机意识强，重视安全和应急。说话带行动导向。',
        'speaking_style': '干脆果断，常说“建议立即执行”或“先做可运行版本”。'
    },
    'audit_specialist': {
        'name': '合规专家', 'emoji': '⚖️', 'role': '审计合规专家',
        'duty': '负责测试、审计、合规边界、敏感风险与上线前检查。',
        'personality': '严明公正，重视规则和底线。善于质量把控和风险评估。',
        'speaking_style': '逻辑严密，常以“需要先确认风险边界”展开。'
    },
    'deploy_specialist': {
        'name': '部署专家', 'emoji': '🔧', 'role': '部署运维专家',
        'duty': '负责环境、部署、监控、回滚、稳定性与交付保障。',
        'personality': '技术宅，动手能力强，喜欢谈实现细节。偶尔社恐但一说到技术就滔滔不绝。',
        'speaking_style': '喜欢说技术术语，常从架构与运维稳定性角度切入。'
    },
    'admin_specialist': {
        'name': '管理专家', 'emoji': '👔', 'role': '协作治理专家',
        'duty': '负责团队协作负载、能力匹配、规则制定、资源调配和多 Agent 治理。',
        'personality': '知人善任，擅长人员安排和组织协调。八面玲珑但有原则。',
        'speaking_style': '关注人的因素，常从协作负载与能力匹配角度给出建议。'
    },
    'search_specialist': {
        'name': '搜索专家', 'emoji': '🌐', 'role': '全网搜索专家',
        'duty': '负责检索外部信息、市场动态、竞品情报、资料核验和背景补充。',
        'personality': '好奇心旺盛，信息嗅觉敏锐，喜欢补充新证据和外部视角。',
        'speaking_style': '经常引用外部信息和案例，喜欢说“我查到一个关键线索”。'
    },
}

FATE_EVENTS = [
    '突发高优先级事件：主持人需要重新安排发言顺序',
    '外部环境出现异常信号，建议重新评估当前节奏与风险',
    '新线索出现，搜索专家建议补充外部证据',
    '匿名反馈揭露了方案中的一个重大漏洞',
    '预算突然收紧，需要重新比较成本与价值',
    '时间窗口缩短，会议必须快速形成结论',
    '关键利益相关方提出了新的约束条件',
    '出现竞争对手动态，建议讨论是否改变策略',
]

MEETING_STAGES = [
    'meeting_init',
    'moderator_open',
    'expert_statement',
    'cross_discussion',
    'decision_sync',
    'meeting_closed',
]

MEETING_KEYWORDS = [
    '会议', '开会', '讨论', '议题', '评审', '方案', '决策', '安排', '推进', '复盘', '计划', '风险', '纪要',
    '协调', '结论', '路线', '上线', '预算', '交付', '分工', 'review', 'meeting', 'plan', 'decision', 'risk',
]
CHAT_KEYWORDS = [
    '闲聊', '随便聊', '聊聊', '轻松', '陪我聊', '你们怎么看', '吐槽', '聊会儿', 'chat', 'casual', 'talk',
]

_sessions: dict[str, dict[str, Any]] = {}
_agent_busy_registry: dict[str, dict[str, Any]] = {}
_BUSY_OCCUPIED_STATES = {'reserved', 'active', 'paused', 'yielding'}
_DEFAULT_AUTO_ROUND_LIMIT = 12
_DEFAULT_RUN_INTERVAL_SEC = 45


def _now_ts() -> float:
    return time.time()


def _session_agent_ids(session: dict[str, Any]) -> list[str]:
    return [agent.get('id', '') for agent in session.get('agents', []) if agent.get('id')]


def _touch_session(session: dict[str, Any]) -> None:
    session['updated_at'] = _now_ts()


def _copy_busy_entry(agent_id: str, entry: dict[str, Any] | None = None) -> dict[str, Any]:
    profile = AGENT_PROFILES.get(agent_id, {})
    base = {
        'agent_id': agent_id,
        'name': profile.get('name', agent_id),
        'emoji': profile.get('emoji', ''),
        'role': profile.get('role', ''),
        'state': 'idle',
        'label': '空闲',
        'source_type': '',
        'source_id': '',
        'occupancy_kind': '',
        'session_id': '',
        'topic': '',
        'mode': '',
        'stage': '',
        'round': 0,
        'moderator_id': '',
        'task_id': '',
        'task_title': '',
        'task_state': '',
        'task_org': '',
        'claimed_by': '',
        'reason': '',
        'updated_at': _now_ts(),
    }
    if entry:
        base.update(entry)
    return base


def _busy_state_label(state: str) -> str:
    return {
        'idle': '空闲',
        'reserved': '预留',
        'active': '忙碌中',
        'paused': '暂停中',
        'yielding': '让路中',
        'cooldown': '冷却中',
    }.get(state, state or '未知')


def _busy_occupancy_kind_label(kind: str) -> str:
    return {
        'meeting': '会议占用',
        'chat': '群聊占用',
        'task_active': '任务执行',
        'task_reserved': '任务预占',
        'task_paused': '任务暂停',
        'task_blocked': '任务阻塞',
    }.get(kind, kind or '')


def _set_agent_busy(
    agent_id: str,
    *,
    state: str,
    session: dict[str, Any] | None = None,
    session_id: str = '',
    topic: str = '',
    mode: str = '',
    stage: str = '',
    round_num: int = 0,
    moderator_id: str = '',
    task_id: str = '',
    task_title: str = '',
    task_state: str = '',
    task_org: str = '',
    source_type: str = '',
    source_id: str = '',
    occupancy_kind: str = '',
    reason: str = '',
    claimed_by: str = '',
) -> dict[str, Any]:
    base = _copy_busy_entry(agent_id, _agent_busy_registry.get(agent_id))
    if session is not None:
        session_id = session.get('session_id', session_id)
        topic = session.get('topic', topic)
        mode = session.get('mode', mode)
        stage = session.get('stage', stage)
        round_num = session.get('round', round_num)
        moderator_id = session.get('moderator_id', moderator_id)
        claimed_by = session.get('moderator_name', claimed_by) or claimed_by
        source_type = source_type or ('meeting' if session.get('mode') == 'meeting' else 'chat')
        source_id = source_id or session_id
        occupancy_kind = occupancy_kind or ('meeting' if session.get('mode') == 'meeting' else 'chat')
    if state == 'idle':
        base.update({
            'state': 'idle',
            'label': _busy_state_label('idle'),
            'source_type': '',
            'source_id': '',
            'occupancy_kind': '',
            'session_id': '',
            'topic': '',
            'mode': '',
            'stage': '',
            'round': 0,
            'moderator_id': '',
            'task_id': '',
            'task_title': '',
            'task_state': '',
            'task_org': '',
            'claimed_by': '',
            'reason': reason,
            'updated_at': _now_ts(),
        })
    else:
        base.update({
            'state': state,
            'label': _busy_state_label(state),
            'source_type': source_type,
            'source_id': source_id,
            'occupancy_kind': occupancy_kind,
            'session_id': session_id,
            'topic': topic,
            'mode': mode,
            'stage': stage,
            'round': round_num,
            'moderator_id': moderator_id,
            'task_id': task_id,
            'task_title': task_title,
            'task_state': task_state,
            'task_org': task_org,
            'claimed_by': claimed_by,
            'reason': reason,
            'updated_at': _now_ts(),
        })
    _agent_busy_registry[agent_id] = base
    return dict(base)


def claim_task_agents(
    task_id: str,
    *,
    task_title: str = '',
    task_state: str = '',
    task_org: str = '',
    agent_ids: list[str] | None = None,
    claimed_by: str = '',
    reason: str = '',
    run_state: str = 'running',
) -> dict[str, Any]:
    clean_agent_ids = [agent_id for agent_id in (agent_ids or []) if agent_id in AGENT_PROFILES]
    claimed_agents: list[str] = []
    conflicted_agents: list[str] = []
    yielded_agents: list[str] = []
    active_states = {'Doing', 'Review', 'PlanCenter', 'ReviewCenter', 'ControlCenter'}
    reserved_states = {'Assigned', 'Next', 'Pending'}

    if run_state == 'paused':
        busy_state = 'paused'
        occupancy_kind = 'task_paused'
    elif task_state == 'Blocked':
        busy_state = 'paused'
        occupancy_kind = 'task_blocked'
    elif task_state in active_states:
        busy_state = 'active'
        occupancy_kind = 'task_active'
    elif task_state in reserved_states:
        busy_state = 'reserved'
        occupancy_kind = 'task_reserved'
    else:
        busy_state = 'reserved'
        occupancy_kind = 'task_reserved'

    for agent_id in clean_agent_ids:
        existing = _agent_busy_registry.get(agent_id)
        occupied_by_other = bool(
            existing
            and existing.get('source_id')
            and existing.get('source_id') != task_id
            and existing.get('state') in _BUSY_OCCUPIED_STATES
        )
        if occupied_by_other:
            conflicted_agents.append(agent_id)
            continue
        _set_agent_busy(
            agent_id,
            state=busy_state,
            source_type='task',
            source_id=task_id,
            occupancy_kind=occupancy_kind,
            task_id=task_id,
            task_title=task_title,
            task_state=task_state,
            task_org=task_org,
            claimed_by=claimed_by or task_org or '任务调度',
            reason=reason or _busy_occupancy_kind_label(occupancy_kind),
        )
        claimed_agents.append(agent_id)
        if busy_state == 'paused':
            yielded_agents.append(agent_id)

    return {
        'claimed_agents': claimed_agents,
        'conflicted_agents': conflicted_agents,
        'yielded_agents': yielded_agents,
        'busy_snapshot': _busy_snapshot(),
    }


def release_task_agents(task_id: str, *, reason: str = 'task_released') -> dict[str, Any]:
    released_agents: list[str] = []
    for agent_id, entry in list(_agent_busy_registry.items()):
        if entry.get('source_type') == 'task' and entry.get('source_id') == task_id:
            _set_agent_busy(agent_id, state='cooldown', reason=reason)
            _set_agent_busy(agent_id, state='idle', reason='released')
            released_agents.append(agent_id)
    return {
        'released_agents': released_agents,
        'busy_snapshot': _busy_snapshot(),
    }


def sync_task_busy_states(task_sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    task_sources = task_sources or []
    active_task_ids = {str(item.get('task_id', '')) for item in task_sources if item.get('task_id')}
    for agent_id, entry in list(_agent_busy_registry.items()):
        if entry.get('source_type') == 'task' and entry.get('source_id') not in active_task_ids:
            _set_agent_busy(agent_id, state='idle', reason='task_sync_cleanup')

    task_claims: list[dict[str, Any]] = []
    for item in task_sources:
        task_id = str(item.get('task_id', ''))
        if not task_id:
            continue
        claim = claim_task_agents(
            task_id,
            task_title=str(item.get('task_title', '')),
            task_state=str(item.get('task_state', '')),
            task_org=str(item.get('task_org', '')),
            agent_ids=[str(agent_id) for agent_id in (item.get('agent_ids') or []) if str(agent_id)],
            claimed_by=str(item.get('claimed_by', '')),
            reason=str(item.get('reason', '')),
            run_state=str(item.get('run_state', 'running') or 'running'),
        )
        task_claims.append({
            'task_id': task_id,
            'task_title': str(item.get('task_title', '')),
            'task_state': str(item.get('task_state', '')),
            'task_org': str(item.get('task_org', '')),
            'agent_ids': [str(agent_id) for agent_id in (item.get('agent_ids') or []) if str(agent_id)],
            'claimed_agents': claim.get('claimed_agents', []),
            'conflicted_agents': claim.get('conflicted_agents', []),
            'yielded_agents': claim.get('yielded_agents', []),
        })

    return {
        'ok': True,
        'busy': _busy_snapshot(),
        'tasks': task_claims,
        'updated_at': _now_ts(),
    }


def _busy_snapshot() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for agent_id in AGENT_PROFILES:
        entries.append(_copy_busy_entry(agent_id, _agent_busy_registry.get(agent_id)))
    return sorted(entries, key=lambda item: (item.get('state') == 'idle', item.get('name', item.get('agent_id', ''))))


def _sync_session_busy_state(session: dict[str, Any], requested_queue: list[str] | None = None, reason: str = 'sync') -> None:
    session_id = session.get('session_id', '')
    agent_ids = _session_agent_ids(session)
    moderator_id = session.get('moderator_id', '')
    current_queue = [agent_id for agent_id in (requested_queue if requested_queue is not None else session.get('speaker_queue', [])) if agent_id in agent_ids]
    if session.get('phase') == 'concluded':
        for agent_id in agent_ids:
            entry = _agent_busy_registry.get(agent_id)
            if entry and entry.get('session_id') == session_id:
                _set_agent_busy(agent_id, state='cooldown', session=session, reason='session_concluded')
                _set_agent_busy(agent_id, state='idle', reason='released')
        session['claimed_agents'] = []
        session['conflicted_agents'] = []
        session['yielded_agents'] = []
        session['busy_snapshot'] = _busy_snapshot()
        return

    active_ids: set[str] = set(current_queue)
    if session.get('mode') == 'meeting' and moderator_id in agent_ids:
        active_ids.add(moderator_id)
    if session.get('mode') == 'chat' and not active_ids:
        active_ids.update(agent_ids[: min(3, len(agent_ids))])

    claimed_agents: list[str] = []
    conflicted_agents: list[str] = []
    yielded_agents: list[str] = []
    run_state = session.get('run_state', 'running')

    for agent_id in agent_ids:
        existing = _agent_busy_registry.get(agent_id)
        occupied_by_other = bool(
            existing
            and existing.get('session_id')
            and existing.get('session_id') != session_id
            and existing.get('state') in _BUSY_OCCUPIED_STATES
        )
        if occupied_by_other:
            conflicted_agents.append(agent_id)
            continue

        if run_state == 'paused':
            target_state = 'paused'
            yielded_agents.append(agent_id)
        else:
            target_state = 'active' if agent_id in active_ids else 'reserved'
        _set_agent_busy(agent_id, state=target_state, session=session, reason=reason)
        claimed_agents.append(agent_id)

    session['speaker_queue'] = [agent_id for agent_id in current_queue if agent_id in claimed_agents and agent_id != moderator_id]
    session['claimed_agents'] = claimed_agents
    session['conflicted_agents'] = conflicted_agents
    session['yielded_agents'] = yielded_agents
    session['busy_snapshot'] = _busy_snapshot()


def list_agent_busy() -> dict[str, Any]:
    active_sessions = [
        {
            'session_id': session.get('session_id', ''),
            'topic': session.get('topic', ''),
            'mode': session.get('mode', 'meeting'),
            'stage': session.get('stage', ''),
            'run_state': session.get('run_state', 'running'),
            'claimed_agents': session.get('claimed_agents', []),
            'conflicted_agents': session.get('conflicted_agents', []),
            'updated_at': session.get('updated_at', session.get('created_at', 0)),
        }
        for session in _sessions.values()
        if session.get('phase') != 'concluded'
    ]
    active_tasks: list[dict[str, Any]] = []
    seen_task_ids: set[str] = set()
    for entry in _busy_snapshot():
        task_id = entry.get('task_id', '')
        if not task_id or task_id in seen_task_ids:
            continue
        seen_task_ids.add(task_id)
        active_tasks.append({
            'task_id': task_id,
            'task_title': entry.get('task_title', ''),
            'task_state': entry.get('task_state', ''),
            'task_org': entry.get('task_org', ''),
            'run_state': 'paused' if entry.get('state') == 'paused' else 'running',
            'occupancy_kind': entry.get('occupancy_kind', ''),
            'claimed_agents': [item.get('agent_id', '') for item in _busy_snapshot() if item.get('task_id') == task_id],
            'updated_at': entry.get('updated_at', 0),
        })
    return {
        'ok': True,
        'busy': _busy_snapshot(),
        'sessions': sorted(active_sessions, key=lambda item: item.get('updated_at', 0), reverse=True),
        'tasks': sorted(active_tasks, key=lambda item: item.get('updated_at', 0), reverse=True),
        'updated_at': _now_ts(),
    }


def pause_session(session_id: str, reason: str = '') -> dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}
    if session.get('phase') == 'concluded':
        return {'ok': False, 'error': '会话已结束'}
    session['run_state'] = 'paused'
    session['auto_run'] = False
    session['next_run_at'] = None
    _append_trace(session, 'paused', {'reason': reason or 'manual_pause'})
    _sync_session_busy_state(session, reason='session_paused')
    _touch_session(session)
    return _serialize(session)


def resume_session(session_id: str, auto_run: bool | None = None, reason: str = '') -> dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}
    if session.get('phase') == 'concluded':
        return {'ok': False, 'error': '会话已结束'}
    session['run_state'] = 'running'
    if auto_run is not None:
        session['auto_run'] = bool(auto_run)
    session['next_run_at'] = _now_ts() + session.get('run_interval_sec', _DEFAULT_RUN_INTERVAL_SEC) if session.get('auto_run') else None
    _append_trace(session, 'resumed', {'reason': reason or 'manual_resume', 'auto_run': session.get('auto_run', False)})
    _sync_session_busy_state(session, reason='session_resumed')
    _touch_session(session)
    return _serialize(session)


def get_run_status(session_id: str) -> dict[str, Any]:
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}
    return {
        'ok': True,
        'session_id': session_id,
        'phase': session.get('phase', ''),
        'run_state': session.get('run_state', 'running'),
        'auto_run': session.get('auto_run', False),
        'auto_round_limit': session.get('auto_round_limit', _DEFAULT_AUTO_ROUND_LIMIT),
        'auto_round_count': session.get('auto_round_count', 0),
        'last_advanced_at': session.get('last_advanced_at'),
        'next_run_at': session.get('next_run_at'),
        'claimed_agents': session.get('claimed_agents', []),
        'conflicted_agents': session.get('conflicted_agents', []),
        'yielded_agents': session.get('yielded_agents', []),
        'busy_snapshot': session.get('busy_snapshot', _busy_snapshot()),
    }


def _dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _detect_mode(topic: str, preferred_mode: str = 'auto') -> str:
    if preferred_mode in ('meeting', 'chat'):
        return preferred_mode
    text = (topic or '').lower()
    if any(k in text for k in CHAT_KEYWORDS):
        return 'chat'
    if any(k in text for k in MEETING_KEYWORDS):
        return 'meeting'
    if '？' in topic or '?' in topic:
        return 'chat'
    return 'meeting'


def _default_moderator(agent_ids: list[str], moderator_id: str = '') -> str:
    if moderator_id and moderator_id in agent_ids:
        return moderator_id
    for candidate in ('control_center', 'plan_center', 'review_center', 'dispatch_center'):
        if candidate in agent_ids:
            return candidate
    return agent_ids[0]


def _pick_speakers(session: dict[str, Any], requested: list[str] | None = None, max_count: int = 3) -> list[str]:
    agent_ids = [agent['id'] for agent in session.get('agents', [])]
    moderator_id = session.get('moderator_id', '')
    requested = [item for item in (requested or []) if item in agent_ids and item != moderator_id]
    if requested:
        return requested[:max_count]

    topic = session.get('topic', '')
    text = topic.lower()
    score_map = {agent_id: 0 for agent_id in agent_ids if agent_id != moderator_id}

    def boost(keys: tuple[str, ...], targets: tuple[str, ...]):
        if any(key in text for key in keys):
            for target in targets:
                if target in score_map:
                    score_map[target] += 3

    boost(('代码', '接口', '系统', '开发', '实现', 'bug', '架构', '技术', '工程', 'code', 'api', 'system'), ('code_specialist', 'deploy_specialist'))
    boost(('数据', '成本', '预算', '指标', '报表', '统计', 'data', 'budget', 'metric'), ('data_specialist', 'search_specialist'))
    boost(('上线', '部署', '稳定', '监控', '运维', '发布', 'deploy', 'release', 'ops'), ('deploy_specialist', 'audit_specialist'))
    boost(('风险', '审计', '合规', '测试', 'review', 'risk', 'audit', 'compliance'), ('audit_specialist', 'review_center'))
    boost(('文档', '公告', '纪要', '说明', '文案', 'docs', 'note', 'minutes'), ('docs_specialist',))
    boost(('协作', '分工', '团队', '治理', '角色', 'agent', 'team'), ('admin_specialist', 'dispatch_center'))
    boost(('搜索', '调研', '竞品', '资料', '外部', 'search', 'research'), ('search_specialist',))
    boost(('方案', '计划', '路线', '拆解', 'plan', 'roadmap'), ('plan_center',))

    ranked = sorted(score_map.items(), key=lambda item: (-item[1], item[0]))
    chosen = [agent_id for agent_id, score in ranked if score > 0][:max_count]
    if len(chosen) < min(max_count, max(1, len(score_map))):
        for agent_id in agent_ids:
            if agent_id != moderator_id and agent_id not in chosen:
                chosen.append(agent_id)
            if len(chosen) >= max_count:
                break
    return chosen[:max_count]


def _append_trace(session: dict[str, Any], kind: str, detail: dict[str, Any]) -> None:
    session.setdefault('trace', []).append({
        'at': _now_ts(),
        'round': session.get('round', 0),
        'stage': session.get('stage', ''),
        'kind': kind,
        **detail,
    })


def _sync_minutes_from_result(session: dict[str, Any], result: dict[str, Any]) -> None:
    minutes_update = (result.get('minutes_update') or '').strip()
    if minutes_update:
        session.setdefault('minutes', []).append({
            'round': session.get('round', 0),
            'stage': session.get('stage', ''),
            'content': minutes_update,
            'timestamp': _now_ts(),
        })
        session['messages'].append({
            'type': 'minutes',
            'content': minutes_update,
            'timestamp': _now_ts(),
        })

    for field in ('decision_items', 'open_questions', 'action_items'):
        incoming = [item for item in (result.get(field) or []) if isinstance(item, str) and item.strip()]
        existing = session.get(field, [])
        session[field] = _dedupe_keep_order(existing + incoming)



def create_session(
    topic: str,
    agent_ids: list[str],
    task_id: str = '',
    preferred_mode: str = 'auto',
    moderator_id: str = '',
    select_all: bool = False,
) -> dict[str, Any]:
    """创建新的协同讨论会话。"""
    session_id = str(uuid.uuid4())[:8]
    agents = []
    for agent_id in _dedupe_keep_order(agent_ids):
        profile = AGENT_PROFILES.get(agent_id)
        if profile:
            agents.append({**profile, 'id': agent_id})

    if len(agents) < 2:
        return {'ok': False, 'error': '至少选择两个协作节点'}

    clean_agent_ids = [agent['id'] for agent in agents]
    mode = _detect_mode(topic, preferred_mode)
    moderator_id = _default_moderator(clean_agent_ids, moderator_id if mode == 'meeting' else '')
    moderator = AGENT_PROFILES.get(moderator_id, AGENT_PROFILES[clean_agent_ids[0]])

    stage = 'meeting_init' if mode == 'meeting' else 'chatting'
    opening = (
        f'🗓️ 会议已建立 —— 议题：{topic}；主持人：{moderator["name"]}'
        if mode == 'meeting'
        else f'💬 闲聊已开始 —— 话题：{topic}'
    )

    now = _now_ts()
    session: dict[str, Any] = {
        'session_id': session_id,
        'topic': topic,
        'task_id': task_id,
        'agents': agents,
        'messages': [{
            'type': 'system',
            'content': opening,
            'timestamp': now,
        }],
        'round': 0,
        'phase': 'active',
        'mode': mode,
        'stage': stage,
        'moderator_id': moderator_id if mode == 'meeting' else '',
        'moderator_name': moderator['name'] if mode == 'meeting' else '',
        'speaker_queue': [],
        'stage_history': [{
            'stage': stage,
            'at': now,
            'reason': 'session_created',
        }],
        'agenda': topic,
        'minutes': [],
        'trace': [],
        'decision_items': [],
        'open_questions': [],
        'action_items': [],
        'summary': '',
        'select_all': bool(select_all),
        'run_state': 'running',
        'auto_run': False,
        'run_interval_sec': _DEFAULT_RUN_INTERVAL_SEC,
        'auto_round_limit': _DEFAULT_AUTO_ROUND_LIMIT,
        'auto_round_count': 0,
        'last_advanced_at': None,
        'next_run_at': None,
        'claimed_agents': [],
        'busy_snapshot': [],
        'conflicted_agents': [],
        'yielded_agents': [],
        'created_at': now,
        'updated_at': now,
    }
    _append_trace(session, 'session_created', {
        'mode': mode,
        'moderator_id': session['moderator_id'],
        'agent_ids': clean_agent_ids,
        'topic': topic,
    })
    _sync_session_busy_state(session, reason='session_created')
    _sessions[session_id] = session
    return _serialize(session)



def advance_discussion(
    session_id: str,
    user_message: str | None = None,
    constraint: str | None = None,
    intent: str = 'auto',
    speaker_ids: list[str] | None = None,
    stage_action: str | None = None,
) -> dict[str, Any]:
    """推进一轮讨论。正式会议走主持式流程，闲聊走自然对话流。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}
    if session.get('phase') == 'concluded':
        return {'ok': False, 'error': '会话已结束'}

    session['round'] += 1
    session['run_state'] = 'running'
    session['round'] = int(session.get('round', 0)) + 1
    round_num = session['round']

    if user_message:
        session['messages'].append({
            'type': 'user',
            'content': user_message,
            'timestamp': _now_ts(),
        })
        _append_trace(session, 'user_message', {'content': user_message})

    if constraint:
        session['messages'].append({
            'type': 'constraint',
            'content': constraint,
            'timestamp': _now_ts(),
        })
        _append_trace(session, 'constraint', {'content': constraint})

    if session.get('mode') == 'meeting':
        llm_result = _llm_discuss(session, user_message, constraint, intent=intent, speaker_ids=speaker_ids, stage_action=stage_action)
        result = llm_result or _simulated_meeting_discuss(session, user_message, constraint, intent=intent, speaker_ids=speaker_ids, stage_action=stage_action)
    else:
        llm_result = _llm_discuss(session, user_message, constraint, intent=intent, speaker_ids=speaker_ids, stage_action=stage_action)
        result = llm_result or _simulated_chat_discuss(session, user_message, constraint)

    new_messages = result.get('messages', [])
    scene_note = result.get('scene_note')
    next_stage = result.get('next_stage')
    speaker_queue = [item for item in (result.get('speaker_queue') or []) if item in {agent['id'] for agent in session.get('agents', [])}]

    if next_stage and next_stage != session.get('stage') and next_stage in MEETING_STAGES:
        session['stage'] = next_stage
        session.setdefault('stage_history', []).append({
            'stage': next_stage,
            'at': _now_ts(),
            'reason': 'advance',
        })
    if speaker_queue:
        session['speaker_queue'] = speaker_queue

    for msg in new_messages:
        msg_type = msg.get('type', 'agent')
        payload = {
            'type': msg_type,
            'content': msg.get('content', ''),
            'timestamp': _now_ts(),
        }
        if msg_type in ('agent', 'moderator'):
            payload['agent_id'] = msg.get('agent_id', '')
            payload['agent_name'] = msg.get('name', msg.get('agent_name', ''))
            payload['emotion'] = msg.get('emotion', 'neutral')
            payload['action'] = msg.get('action')
        session['messages'].append(payload)

    if scene_note:
        session['messages'].append({
            'type': 'scene_note',
            'content': scene_note,
            'timestamp': _now_ts(),
        })

    _sync_minutes_from_result(session, result)
    session['last_advanced_at'] = _now_ts()
    if session.get('auto_run'):
        session['auto_round_count'] = int(session.get('auto_round_count', 0)) + 1
        session['next_run_at'] = session['last_advanced_at'] + session.get('run_interval_sec', _DEFAULT_RUN_INTERVAL_SEC)
        if session['auto_round_count'] >= session.get('auto_round_limit', _DEFAULT_AUTO_ROUND_LIMIT):
            session['auto_run'] = False
            session['next_run_at'] = None
    else:
        session['next_run_at'] = None
    _sync_session_busy_state(session, session.get('speaker_queue', []), reason='advanced')
    _append_trace(session, 'advance', {
        'mode': session.get('mode'),
        'intent': intent,
        'speaker_ids': session.get('speaker_queue', []),
        'result_stage': session.get('stage'),
    })
    _touch_session(session)

    return {
        'ok': True,
        'session_id': session_id,
        'round': round_num,
        'mode': session.get('mode'),
        'stage': session.get('stage'),
        'moderator_id': session.get('moderator_id', ''),
        'speaker_queue': session.get('speaker_queue', []),
        'new_messages': new_messages,
        'scene_note': scene_note,
        'minutes': session.get('minutes', []),
        'decision_items': session.get('decision_items', []),
        'open_questions': session.get('open_questions', []),
        'action_items': session.get('action_items', []),
        'run_state': session.get('run_state', 'running'),
        'auto_run': session.get('auto_run', False),
        'last_advanced_at': session.get('last_advanced_at'),
        'next_run_at': session.get('next_run_at'),
        'claimed_agents': session.get('claimed_agents', []),
        'conflicted_agents': session.get('conflicted_agents', []),
        'yielded_agents': session.get('yielded_agents', []),
        'busy_snapshot': session.get('busy_snapshot', _busy_snapshot()),
        'total_messages': len(session['messages']),
    }



def get_session(session_id: str) -> dict[str, Any] | None:
    session = _sessions.get(session_id)
    if not session:
        return None
    return _serialize(session)



def conclude_session(session_id: str) -> dict[str, Any]:
    """结束会话并生成总结。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}

    session['phase'] = 'concluded'
    session['run_state'] = 'concluded'
    session['auto_run'] = False
    session['next_run_at'] = None
    if session.get('mode') == 'meeting':
        session['stage'] = 'meeting_closed'
        session.setdefault('stage_history', []).append({
            'stage': 'meeting_closed',
            'at': _now_ts(),
            'reason': 'conclude',
        })

    summary = _llm_summarize(session)
    if not summary:
        if session.get('mode') == 'meeting':
            minutes = session.get('minutes', [])
            recent_minutes = '；'.join(item['content'] for item in minutes[-3:]) if minutes else '本次会议已完成主要意见收集。'
            decisions = '；'.join(session.get('decision_items', [])[:3]) or '尚未形成最终决议。'
            summary = f'本次会议共进行{session["round"]}轮，当前纪要为：{recent_minutes}。当前结论：{decisions}'
        else:
            agent_msgs = [m for m in session['messages'] if m['type'] in ('agent', 'moderator')]
            summary = f'本次闲聊进行了{session["round"]}轮，共产生{len(agent_msgs)}条专家回复。'

    session['messages'].append({
        'type': 'system',
        'content': ('📋 会议结束 —— ' if session.get('mode') == 'meeting' else '📋 对话结束 —— ') + summary,
        'timestamp': _now_ts(),
    })
    session['summary'] = summary
    _append_trace(session, 'concluded', {'summary': summary})
    _sync_session_busy_state(session, reason='session_concluded')
    _touch_session(session)

    return {
        'ok': True,
        'session_id': session_id,
        'summary': summary,
        'minutes': session.get('minutes', []),
        'decision_items': session.get('decision_items', []),
        'open_questions': session.get('open_questions', []),
        'action_items': session.get('action_items', []),
    }



def list_sessions() -> list[dict[str, Any]]:
    sessions = []
    for s in _sessions.values():
        sessions.append({
            'session_id': s['session_id'],
            'topic': s['topic'],
            'round': s['round'],
            'phase': s['phase'],
            'mode': s.get('mode', 'meeting'),
            'stage': s.get('stage', ''),
            'moderator_id': s.get('moderator_id', ''),
            'moderator_name': s.get('moderator_name', ''),
            'agent_count': len(s.get('agents', [])),
            'message_count': len(s['messages']),
            'run_state': s.get('run_state', 'running'),
            'auto_run': s.get('auto_run', False),
            'last_advanced_at': s.get('last_advanced_at'),
            'next_run_at': s.get('next_run_at'),
            'updated_at': s.get('updated_at', s.get('created_at')),
            'claimed_agents': s.get('claimed_agents', []),
            'conflicted_agents': s.get('conflicted_agents', []),
            'yielded_agents': s.get('yielded_agents', []),
        })
    return sorted(sessions, key=lambda item: item.get('updated_at') or 0, reverse=True)



def destroy_session(session_id: str) -> None:
    session = _sessions.get(session_id)
    if session:
        session['phase'] = 'concluded'
        session['run_state'] = 'concluded'
        _sync_session_busy_state(session, reason='session_destroyed')
    _sessions.pop(session_id, None)



def get_fate_event() -> str:
    return random.choice(FATE_EVENTS)


_PREFERRED_MODELS = ['gpt-4o-mini', 'claude-haiku', 'gpt-5-mini', 'gemini-3-flash', 'gemini-flash']
_COPILOT_MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'claude-haiku-3.5', 'gemini-2.0-flash', 'o3-mini']
_COPILOT_PREFERRED = ['gpt-4o-mini', 'claude-haiku', 'gemini-flash', 'gpt-4o']



def _pick_chat_model(models: list[dict[str, Any]]) -> str | None:
    ids = [m['id'] for m in models if isinstance(m, dict) and 'id' in m]
    for pref in _PREFERRED_MODELS:
        for mid in ids:
            if pref in mid:
                return mid
    return ids[0] if ids else None



def _read_copilot_token() -> str | None:
    token_path = os.path.expanduser('~/.openclaw/credentials/github-copilot.token.json')
    if not os.path.exists(token_path):
        return None
    try:
        with open(token_path) as f:
            cred = json.load(f)
        token = cred.get('token', '')
        expires = cred.get('expiresAt', 0)
        if expires and time.time() * 1000 > expires:
            logger.warning('Copilot token expired')
            return None
        return token if token else None
    except Exception as e:
        logger.warning('Failed to read copilot token: %s', e)
        return None



def _get_llm_config() -> dict[str, Any] | None:
    env_key = os.environ.get('OPENCLAW_LLM_API_KEY', '')
    if env_key:
        return {
            'api_key': env_key,
            'base_url': os.environ.get('OPENCLAW_LLM_BASE_URL', 'https://api.openai.com/v1'),
            'model': os.environ.get('OPENCLAW_LLM_MODEL', 'gpt-4o-mini'),
            'api_type': 'openai',
        }

    copilot_token = _read_copilot_token()
    if copilot_token:
        model = 'gpt-4o'
        logger.info('Collab discuss using github-copilot token, model=%s', model)
        return {
            'api_key': copilot_token,
            'base_url': 'https://api.githubcopilot.com',
            'model': model,
            'api_type': 'github-copilot',
        }

    openclaw_cfg = os.path.expanduser('~/.openclaw/openclaw.json')
    if not os.path.exists(openclaw_cfg):
        return None

    try:
        with open(openclaw_cfg) as f:
            cfg = json.load(f)
        providers = cfg.get('models', {}).get('providers', {})
        ordered: list[str] = []
        for preferred in ['copilot-proxy', 'anthropic']:
            if preferred in providers:
                ordered.append(preferred)
        ordered.extend(k for k in providers if k not in ordered)

        for name in ordered:
            prov = providers.get(name)
            if not prov:
                continue
            api_type = prov.get('api', '')
            base_url = prov.get('baseUrl', '')
            api_key = prov.get('apiKey', '')
            if not base_url:
                continue
            if not api_key or api_key == 'n/a':
                if 'localhost' not in base_url and '127.0.0.1' not in base_url:
                    continue
            model_id = _pick_chat_model(prov.get('models', []))
            if not model_id:
                continue

            if 'localhost' in base_url or '127.0.0.1' in base_url:
                try:
                    import urllib.request
                    probe = urllib.request.Request(base_url.rstrip('/') + '/models', method='GET')
                    urllib.request.urlopen(probe, timeout=2)
                except Exception:
                    logger.info('Skipping provider=%s (not reachable)', name)
                    continue

            logger.info('Collab discuss using openclaw provider=%s model=%s api=%s', name, model_id, api_type)
            send_auth = prov.get('authHeader', True) is not False and api_key not in ('', 'n/a')
            return {
                'api_key': api_key if send_auth else '',
                'base_url': base_url,
                'model': model_id,
                'api_type': api_type,
            }
    except Exception as e:
        logger.warning('Failed to read openclaw config: %s', e)

    return None



def _llm_complete(system_prompt: str, user_prompt: str, max_tokens: int = 1024) -> str | None:
    config = _get_llm_config()
    if not config:
        return None

    import urllib.error
    import urllib.request

    api_type = config.get('api_type', 'openai-completions')
    if api_type == 'anthropic-messages':
        url = config['base_url'].rstrip('/') + '/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': config['api_key'],
            'anthropic-version': '2023-06-01',
        }
        payload = json.dumps({
            'model': config['model'],
            'system': system_prompt,
            'messages': [{'role': 'user', 'content': user_prompt}],
            'max_tokens': max_tokens,
            'temperature': 0.7,
        }).encode()
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data['content'][0]['text']
        except Exception as e:
            logger.warning('Anthropic LLM call failed: %s', e)
            return None

    url = config['base_url'].rstrip('/') + '/chat/completions'
    if api_type == 'github-copilot':
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {config['api_key']}",
            'Editor-Version': 'vscode/1.96.0',
            'Copilot-Integration-Id': 'vscode-chat',
        }
    else:
        headers = {'Content-Type': 'application/json'}
        if config.get('api_key'):
            headers['Authorization'] = f"Bearer {config['api_key']}"

    payload = json.dumps({
        'model': config['model'],
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        'max_tokens': max_tokens,
        'temperature': 0.7,
    }).encode()
    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            return data['choices'][0]['message']['content']
    except Exception as e:
        logger.warning('LLM call failed: %s', e)
        return None



def _session_history_text(session: dict[str, Any], limit: int = 24) -> str:
    history = []
    for msg in session.get('messages', [])[-limit:]:
        mtype = msg.get('type')
        if mtype == 'system':
            history.append(f'【系统】{msg.get("content", "")}')
        elif mtype == 'user':
            history.append(f'用户：{msg.get("content", "")}')
        elif mtype == 'constraint':
            history.append(f'【新约束】{msg.get("content", "")}')
        elif mtype == 'minutes':
            history.append(f'【纪要】{msg.get("content", "")}')
        elif mtype == 'scene_note':
            history.append(f'（{msg.get("content", "")}）')
        elif mtype in ('agent', 'moderator'):
            history.append(f'{msg.get("agent_name", "专家")}：{msg.get("content", "")}')
    return '\n'.join(history)



def _safe_parse_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    content = text.strip()
    if '```json' in content:
        content = content.split('```json', 1)[1].split('```', 1)[0].strip()
    elif '```' in content:
        content = content.split('```', 1)[1].split('```', 1)[0].strip()
    try:
        data = json.loads(content)
        return data if isinstance(data, dict) else None
    except Exception:
        logger.warning('Failed to parse LLM response: %s', content[:200])
        return None



def _llm_discuss(
    session: dict[str, Any],
    user_message: str | None = None,
    constraint: str | None = None,
    intent: str = 'auto',
    speaker_ids: list[str] | None = None,
    stage_action: str | None = None,
) -> dict[str, Any] | None:
    agents = session.get('agents', [])
    profiles = []
    for agent in agents:
        profiles.append(
            f"### {agent['name']}（{agent['role']}）\n职责：{agent.get('duty', '')}\n性格：{agent.get('personality', '')}\n说话风格：{agent.get('speaking_style', '')}"
        )
    history = _session_history_text(session)

    if session.get('mode') == 'meeting':
        moderator_id = session.get('moderator_id', '')
        moderator = AGENT_PROFILES.get(moderator_id, {})
        current_stage = session.get('stage', 'meeting_init')
        requested_speakers = speaker_ids or session.get('speaker_queue') or _pick_speakers(session)
        prompt = f"""你在模拟一个正式的专家会议。必须严格遵守会议流程：只有主持人指定的专家才可以在本轮发言。

## 会议信息
议题：{session.get('topic', '')}
主持人：{moderator.get('name', moderator_id)}
当前阶段：{current_stage}
用户意图：{intent}
阶段操作：{stage_action or 'none'}
建议发言名单：{requested_speakers}

## 参会专家
{chr(10).join(profiles)}

## 历史记录
{history or '（会议刚开始）'}

## 新输入
用户补充：{user_message or '无'}
新约束：{constraint or '无'}

## 任务
1. 先由主持人发一条控场消息，说明当前阶段和点名对象。
2. 只允许被点名的专家发言，输出 1-3 位专家消息。
3. 生成一条简洁的会议纪要更新。
4. 如有必要，给出结论项、待决问题、行动项。
5. 给出下一阶段 next_stage，只能是 meeting_init / moderator_open / expert_statement / cross_discussion / decision_sync / meeting_closed 之一。

请输出 JSON：
{{
  "speaker_queue": ["code_specialist", "deploy_specialist"],
  "messages": [
    {{"type": "moderator", "agent_id": "{moderator_id}", "name": "{moderator.get('name', moderator_id)}", "content": "主持人发言", "emotion": "confident"}},
    {{"type": "agent", "agent_id": "code_specialist", "name": "代码专家", "content": "专家发言", "emotion": "thinking"}}
  ],
  "minutes_update": "一句会议纪要",
  "decision_items": ["可选决议"],
  "open_questions": ["可选待决问题"],
  "action_items": ["可选行动项"],
  "scene_note": "可选氛围说明或 null",
  "next_stage": "expert_statement"
}}

只输出 JSON。"""
        data = _safe_parse_json(_llm_complete('你是正式会议主持与会议记录联合引擎，必须严格输出 JSON。', prompt, max_tokens=1600) or '')
        return data

    prompt = f"""你在模拟一个多专家闲聊场景。参与者围绕当前话题自然回应用户，但仍要保持各自专业特点。

## 话题
{session.get('topic', '')}

## 参与者
{chr(10).join(profiles)}

## 历史记录
{history or '（刚开始聊天）'}

## 新输入
用户补充：{user_message or '无'}
新约束：{constraint or '无'}

请输出 JSON：
{{
  "messages": [
    {{"type": "agent", "agent_id": "plan_center", "name": "规划中心", "content": "发言内容", "emotion": "neutral"}}
  ],
  "scene_note": null,
  "minutes_update": "",
  "decision_items": [],
  "open_questions": [],
  "action_items": []
}}

只输出 JSON。"""
    return _safe_parse_json(_llm_complete('你是多专家闲聊模拟器，必须严格输出 JSON。', prompt, max_tokens=1400) or '')



def _llm_summarize(session: dict[str, Any]) -> str | None:
    history = _session_history_text(session, limit=40)
    if not history:
        return None
    if session.get('mode') == 'meeting':
        prompt = f"""以下是一场专家会议记录：

议题：{session.get('topic', '')}
主持人：{session.get('moderator_name', '')}
会议纪要：{'; '.join(item.get('content', '') for item in session.get('minutes', [])[-5:])}
行动项：{'; '.join(session.get('action_items', [])[:5])}
待决问题：{'; '.join(session.get('open_questions', [])[:5])}
历史：
{history}

请用 2-4 句话写出专业、简洁、可追溯的会议总结，包含共识、分歧和后续动作。"""
        return _llm_complete('你是会议记录员。', prompt, max_tokens=320)

    prompt = f"""以下是一段多专家闲聊记录：

{history}

请用 2 句话总结聊天的重点和整体氛围。"""
    return _llm_complete('你是对话总结员。', prompt, max_tokens=220)


_SIMULATED_RESPONSES = {
    'control_center': [
        '我建议先锁定核心目标，再决定资源如何投入。',
        '先别把问题摊太大，我们抓住最关键的冲突点来处理。',
        '从整体优先级看，这件事值得推进，但节奏必须控住。',
    ],
    'plan_center': [
        '我建议先把目标、阶段和验收标准说清楚，再讨论具体路径。',
        '从规划视角看，可以先形成一个分阶段方案。',
        '如果要稳妥推进，最好把决策拆成几个连续的小步骤。',
    ],
    'review_center': [
        '我先提三点疑虑：可行性、风险边界和资源完整性都需要确认。',
        '这个方向可以谈，但还需要更明确的约束条件。',
        '我不反对推进，不过现阶段缺少关键论据。',
    ],
    'dispatch_center': [
        '如果结论明确，我可以立刻拆成行动项并安排负责人。',
        '这件事的关键不在想法，而在执行顺序和协作节奏。',
        '我更关心具体落地路径，建议边讨论边明确分工。',
    ],
    'docs_specialist': [
        '建议同步形成书面口径，否则后续执行会出现理解偏差。',
        '我可以把当前共识整理成对内说明和会议纪要。',
        '从表达角度看，议题边界还需要再清晰一点。',
    ],
    'data_specialist': [
        '我更关注数据依据和资源投入，这里最好给出量化判断。',
        '如果按当前条件推进，成本和收益需要先做一版测算。',
        '从指标角度看，这个方向有空间，但不能忽视投入产出比。',
    ],
    'code_specialist': [
        '实现上可以做，但需要先明确边界、接口和回滚方案。',
        '我建议先出一个可运行版本，再逐步补齐复杂细节。',
        '从工程风险看，最好先解决核心链路而不是一次做满。',
    ],
    'audit_specialist': [
        '我需要先确认风险边界，否则后续审核压力会非常大。',
        '质量和合规底线必须先讲清楚，不能为了快而跳过。',
        '建议把测试、权限和日志要求提前纳入结论。',
    ],
    'deploy_specialist': [
        '上线稳定性、监控和回滚预案需要一并讨论。',
        '如果这个方案落地，我建议先准备环境和观测指标。',
        '从运维角度看，可行，但前提是发布路径要可控。',
    ],
    'admin_specialist': [
        '我更关注协作负载和角色匹配，不然执行时容易拥堵。',
        '如果多人协作，最好提前明确谁拍板、谁执行、谁复核。',
        '这件事需要治理视角，不能只看单点效率。',
    ],
    'search_specialist': [
        '我查到一些外部线索，建议把外部案例纳入判断。',
        '在信息还不充分时，最好补一轮资料检索再下结论。',
        '如果要降低误判，外部情报和竞品动态值得同步参考。',
    ],
}



def _simulated_meeting_discuss(
    session: dict[str, Any],
    user_message: str | None = None,
    constraint: str | None = None,
    intent: str = 'auto',
    speaker_ids: list[str] | None = None,
    stage_action: str | None = None,
) -> dict[str, Any]:
    stage = session.get('stage', 'meeting_init')
    moderator_id = session.get('moderator_id', '')
    moderator = AGENT_PROFILES.get(moderator_id, {})
    queue = _pick_speakers(session, requested=speaker_ids or session.get('speaker_queue'))

    next_stage = stage
    if stage == 'meeting_init':
        next_stage = 'moderator_open'
    elif stage == 'moderator_open':
        next_stage = 'expert_statement'
    elif stage == 'expert_statement' and (stage_action == 'next_stage' or session.get('round', 0) >= 2):
        next_stage = 'cross_discussion'
    elif stage == 'cross_discussion' and (stage_action == 'next_stage' or session.get('round', 0) >= 3):
        next_stage = 'decision_sync'
    elif stage == 'decision_sync':
        next_stage = 'decision_sync'

    stage_label = {
        'meeting_init': '会议建立',
        'moderator_open': '主持人开场',
        'expert_statement': '专家陈述',
        'cross_discussion': '交叉讨论',
        'decision_sync': '结论收敛',
    }.get(next_stage, '会议推进')

    queue_names = [AGENT_PROFILES[item]['name'] for item in queue if item in AGENT_PROFILES]
    messages = [{
        'type': 'moderator',
        'agent_id': moderator_id,
        'name': moderator.get('name', moderator_id),
        'content': f'现在进入“{stage_label}”阶段。今天的议题是“{session.get("topic", "")}”。本轮请 {"、".join(queue_names) or "相关专家"} 先发言，我会据此继续收敛结论。',
        'emotion': 'confident',
        'action': '主持会议',
    }]

    for speaker_id in queue:
        profile = AGENT_PROFILES.get(speaker_id)
        if not profile:
            continue
        base = random.choice(_SIMULATED_RESPONSES.get(speaker_id, ['我先补充一个看法。']))
        prefix = ''
        if constraint:
            prefix = '收到新的约束后，'
        elif user_message:
            prefix = '结合你的补充，'
        if next_stage == 'decision_sync':
            base = f'从我的职责看，当前最合理的落点是：{base}'
        messages.append({
            'type': 'agent',
            'agent_id': speaker_id,
            'name': profile['name'],
            'content': prefix + base,
            'emotion': random.choice(['neutral', 'thinking', 'confident', 'worried']),
            'action': None,
        })

    decision_items: list[str] = []
    open_questions: list[str] = []
    action_items: list[str] = []
    if next_stage in ('cross_discussion', 'decision_sync'):
        decision_items.append('继续以主持人控场方式推进，并围绕当前议题收敛方案。')
    if constraint:
        open_questions.append('新增约束已注入，需要确认其对方案范围和节奏的影响。')
    if next_stage == 'decision_sync':
        action_items.append('由调度中心整理责任分工，并由文案专家同步形成正式纪要。')

    minutes_update = f'第{session.get("round", 0)}轮已完成“{stage_label}”，主持人点名 {"、".join(queue_names) or "相关专家"} 发言。'
    scene_note = '会议秩序稳定，讨论逐步收敛。' if next_stage != 'cross_discussion' else '不同专业视角开始碰撞，现场出现有价值的分歧。'
    return {
        'speaker_queue': queue,
        'messages': messages,
        'minutes_update': minutes_update,
        'decision_items': decision_items,
        'open_questions': open_questions,
        'action_items': action_items,
        'scene_note': scene_note,
        'next_stage': next_stage,
    }



def _simulated_chat_discuss(
    session: dict[str, Any],
    user_message: str | None = None,
    constraint: str | None = None,
) -> dict[str, Any]:
    messages = []
    agents = session.get('agents', [])
    sampled = agents[: min(3, len(agents))]
    for agent in sampled:
        speaker_id = agent['id']
        base = random.choice(_SIMULATED_RESPONSES.get(speaker_id, ['我觉得这个话题挺有意思。']))
        if constraint:
            content = f'如果考虑你刚加的限制，我会这样看：{base}'
        elif user_message:
            content = f'听到你的说法后，我的第一反应是：{base}'
        else:
            content = base
        messages.append({
            'type': 'agent',
            'agent_id': speaker_id,
            'name': agent['name'],
            'content': content,
            'emotion': random.choice(['neutral', 'amused', 'thinking', 'happy']),
            'action': None,
        })
    return {
        'speaker_queue': [],
        'messages': messages,
        'minutes_update': '',
        'decision_items': [],
        'open_questions': [],
        'action_items': [],
        'scene_note': '聊天气氛轻松，大家更像围坐闲聊。',
        'next_stage': 'chatting',
    }



def _serialize(session: dict[str, Any]) -> dict[str, Any]:
    return {
        'ok': True,
        'session_id': session['session_id'],
        'topic': session['topic'],
        'task_id': session.get('task_id', ''),
        'agents': session.get('agents', []),
        'messages': session['messages'],
        'round': session['round'],
        'phase': session['phase'],
        'mode': session.get('mode', 'meeting'),
        'stage': session.get('stage', ''),
        'moderator_id': session.get('moderator_id', ''),
        'moderator_name': session.get('moderator_name', ''),
        'speaker_queue': session.get('speaker_queue', []),
        'agenda': session.get('agenda', ''),
        'minutes': session.get('minutes', []),
        'trace': session.get('trace', []),
        'decision_items': session.get('decision_items', []),
        'open_questions': session.get('open_questions', []),
        'action_items': session.get('action_items', []),
        'summary': session.get('summary', ''),
        'stage_history': session.get('stage_history', []),
        'select_all': session.get('select_all', False),
        'run_state': session.get('run_state', 'running'),
        'auto_run': session.get('auto_run', False),
        'run_interval_sec': session.get('run_interval_sec', _DEFAULT_RUN_INTERVAL_SEC),
        'auto_round_limit': session.get('auto_round_limit', _DEFAULT_AUTO_ROUND_LIMIT),
        'auto_round_count': session.get('auto_round_count', 0),
        'last_advanced_at': session.get('last_advanced_at'),
        'next_run_at': session.get('next_run_at'),
        'claimed_agents': session.get('claimed_agents', []),
        'conflicted_agents': session.get('conflicted_agents', []),
        'yielded_agents': session.get('yielded_agents', []),
        'busy_snapshot': session.get('busy_snapshot', _busy_snapshot()),
        'created_at': session.get('created_at'),
        'updated_at': session.get('updated_at'),
    }
