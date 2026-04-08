import datetime
import json
import logging
import pathlib
import re
import time
import traceback

from file_lock import atomic_json_read, atomic_json_write

log = logging.getLogger('sync_runtime')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

BASE = pathlib.Path(__file__).resolve().parent.parent
DATA = BASE / 'data'
DATA.mkdir(exist_ok=True)
SYNC_STATUS = DATA / 'sync_status.json'
SESSIONS_ROOT = pathlib.Path.home() / '.openclaw' / 'agents'

MARKER_RE = re.compile(r'\[\[(.*?)\]\]')
NO_REPLY_RE = re.compile(r'^\s*NO_REPLY\b[:：\-\s]*', re.IGNORECASE)

POLICY_ALIASES = {
    'send': 'send',
    'default': 'send',
    'none': 'send',
    'noreply': 'no_reply',
    'donotreply': 'no_reply',
    'skipreply': 'no_reply',
    'replycurrent': 'reply_current',
    'replytocurrent': 'reply_current',
    'replycurrentmessage': 'reply_current',
    'replymessage': 'reply_current',
    'replythread': 'reply_thread',
    'replyinthread': 'reply_thread',
    'threadreply': 'reply_thread',
    'replyroot': 'reply_root',
    'replytoroot': 'reply_root',
    'rootreply': 'reply_root',
}

FIELD_ALIASES = {
    'messageId': {
        'messageid', 'messsageid', 'msgid', 'targetmessageid', 'currentmessageid',
        'lastmessageid', 'originmessageid', 'replymessageid',
    },
    'threadId': {'threadid', 'replythreadid', 'messagethreadid'},
    'rootId': {'rootid', 'messagerootid', 'threadrootid'},
    'chatId': {'chatid', 'conversationid'},
    'senderId': {'senderid', 'userid', 'fromuserid', 'fromuserid', 'operatorid'},
    'senderOpenId': {'openid', 'senderopenid', 'useropenid', 'fromopenid'},
    'replyPolicy': {'replypolicy', 'reportpolicy', 'replymode'},
    'channel': {'channel', 'lastchannel', 'sourcechannel'},
}


def write_status(**kwargs):
    atomic_json_write(SYNC_STATUS, kwargs)


def ms_to_str(ts_ms):
    if not ts_ms:
        return '-'
    try:
        return datetime.datetime.fromtimestamp(ts_ms / 1000).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return '-'


def state_from_session(age_ms, aborted):
    if aborted:
        return 'Blocked'
    if age_ms <= 2 * 60 * 1000:
        return 'Doing'
    if age_ms <= 60 * 60 * 1000:
        return 'Review'
    return 'Next'


def detect_official(agent_id):
    mapping = {
        'control_center': ('总控值守', '总控中心'),
        'plan_center': ('规划协调', '规划中心'),
        'review_center': ('评审协调', '评审中心'),
        'dispatch_center': ('调度协调', '调度中心'),
        'data_specialist': ('数据专家', '数据专家'),
        'docs_specialist': ('文案专家', '文案专家'),
        'code_specialist': ('代码专家', '代码专家'),
        'audit_specialist': ('合规专家', '合规专家'),
        'deploy_specialist': ('部署专家', '部署专家'),
        'admin_specialist': ('Agent管理专家', 'Agent管理专家'),
        'search_specialist': ('搜索专家', '搜索专家'),
    }
    return mapping.get(agent_id, ('调度协调', '调度中心'))


def normalize_key(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def normalize_policy(value):
    normalized = normalize_key(value)
    return POLICY_ALIASES.get(normalized, 'send') if normalized else 'send'


def parse_reply_intent(text):
    raw = str(text or '')
    markers = []
    for marker in MARKER_RE.findall(raw):
        clean = str(marker or '').strip()
        if clean:
            markers.append(clean)

    has_no_reply = bool(NO_REPLY_RE.match(raw))
    policy = 'no_reply' if has_no_reply else 'send'

    for marker in markers:
        mapped = normalize_policy(marker)
        if mapped != 'send':
            policy = mapped
            break
        marker_norm = normalize_key(marker)
        if marker_norm in {'reply', 'replytocurrent'}:
            policy = 'reply_current'
            break

    cleaned = MARKER_RE.sub('', raw)
    cleaned = NO_REPLY_RE.sub('', cleaned)
    cleaned = cleaned.replace('**', '').strip()

    return {
        'policy': policy,
        'markers': markers,
        'hasNoReplyPrefix': has_no_reply,
        'cleanText': cleaned,
    }


def extract_text_from_message(msg):
    if not isinstance(msg, dict):
        return ''
    content = msg.get('content', [])
    if not isinstance(content, list):
        return ''
    parts = []
    for item in content:
        if isinstance(item, dict) and item.get('type') == 'text' and item.get('text'):
            parts.append(str(item.get('text')))
    return '\n'.join(parts).strip()


def load_session_events(session_file):
    p = pathlib.Path(session_file or '')
    if not p.exists():
        return []
    try:
        lines = p.read_text(errors='ignore').splitlines()
    except Exception:
        return []

    events = []
    for ln in lines:
        try:
            item = json.loads(ln)
            if isinstance(item, dict):
                events.append(item)
        except Exception:
            continue
    return events


def load_activity(session_file, limit=12, events=None):
    rows = []
    event_rows = events if events is not None else load_session_events(session_file)

    for item in reversed(event_rows):
        msg = item.get('message') or {}
        role = msg.get('role')
        ts = item.get('timestamp') or ''

        if role == 'toolResult':
            tool = msg.get('toolName', '-')
            content = extract_text_from_message(msg)
            if len(content) < 50:
                text = f"Tool '{tool}' returned: {content}"
            else:
                text = f"Tool '{tool}' finished"
            rows.append({'at': ts, 'kind': 'tool', 'text': text})

        elif role == 'assistant':
            raw_text = extract_text_from_message(msg)
            intent = parse_reply_intent(raw_text)
            text = intent['cleanText']
            if text:
                summary = text.split('\n')[0]
                if len(summary) > 200:
                    summary = summary[:200] + '...'
                rows.append({'at': ts, 'kind': 'assistant', 'text': summary})

        elif role == 'user':
            text = extract_text_from_message(msg)
            if text:
                rows.append({'at': ts, 'kind': 'user', 'text': f"User: {text[:100]}..."})

        if len(rows) >= limit:
            break

    return rows


def _collect_scalar_fields(obj, prefix='root', found=None):
    if found is None:
        found = {}

    if isinstance(obj, dict):
        for key, value in obj.items():
            key_norm = normalize_key(key)
            path = f'{prefix}.{key}'
            for field, aliases in FIELD_ALIASES.items():
                if key_norm in aliases and value not in (None, '', [], {}):
                    found.setdefault(field, {'value': value, 'path': path})
            if isinstance(value, (dict, list)):
                _collect_scalar_fields(value, path, found)
    elif isinstance(obj, list):
        for idx, value in enumerate(obj):
            if isinstance(value, (dict, list)):
                _collect_scalar_fields(value, f'{prefix}[{idx}]', found)

    return found


def build_reply_meta(row, channel, session_file, origin=None, events=None):
    origin = origin or {}
    event_rows = events if events is not None else load_session_events(session_file)

    latest_assistant_text = ''
    latest_assistant_message = {}
    latest_user_message = {}
    for item in reversed(event_rows):
        msg = item.get('message') or {}
        role = msg.get('role')
        if role == 'assistant' and not latest_assistant_text:
            latest_assistant_text = extract_text_from_message(msg)
            latest_assistant_message = msg
        elif role == 'user' and not latest_user_message:
            latest_user_message = msg
        if latest_assistant_text and latest_user_message:
            break

    parsed_intent = parse_reply_intent(latest_assistant_text)
    candidates = _collect_scalar_fields({
        'row': row,
        'origin': origin,
        'latestUserMessage': latest_user_message,
        'latestAssistantMessage': latest_assistant_message,
    })

    explicit_policy = candidates.get('replyPolicy', {}).get('value')
    policy = parsed_intent['policy']
    if policy == 'send' and explicit_policy:
        policy = normalize_policy(explicit_policy)

    detected_channel = str(candidates.get('channel', {}).get('value') or channel or '-').strip() or '-'
    channel_lower = detected_channel.lower()
    is_feishu = 'feishu' in channel_lower or 'lark' in channel_lower

    effective_policy = policy
    fallback_mode = 'none'
    if policy in {'reply_current', 'reply_thread', 'reply_root'}:
        fallback_mode = 'send'
        if not is_feishu:
            effective_policy = 'send'

    context = {
        'targetMessageId': candidates.get('messageId', {}).get('value'),
        'threadId': candidates.get('threadId', {}).get('value'),
        'rootId': candidates.get('rootId', {}).get('value'),
        'chatId': candidates.get('chatId', {}).get('value'),
        'senderId': candidates.get('senderId', {}).get('value'),
        'senderOpenId': candidates.get('senderOpenId', {}).get('value'),
    }
    available_targets = [key for key, value in context.items() if value not in (None, '', [], {})]

    return {
        'channel': detected_channel,
        'channelFamily': 'feishu' if is_feishu else 'other',
        'policy': policy,
        'effectivePolicy': effective_policy,
        'fallbackMode': fallback_mode,
        'transport': 'webhook_notify' if is_feishu else 'generic_notify',
        'parsedFromText': bool(parsed_intent['markers'] or parsed_intent['hasNoReplyPrefix']),
        'markers': parsed_intent['markers'],
        'hasNoReplyPrefix': parsed_intent['hasNoReplyPrefix'],
        'availableTargets': available_targets,
        'hasReplyContext': bool(available_targets),
        **context,
        'sourcePaths': {key: meta.get('path') for key, meta in candidates.items() if meta.get('path')},
    }


def build_task(agent_id, session_key, row, now_ms):
    session_id = row.get('sessionId') or session_key
    updated_at = row.get('updatedAt') or 0
    age_ms = max(0, now_ms - updated_at) if updated_at else 99 * 24 * 3600 * 1000
    aborted = bool(row.get('abortedLastRun'))
    state = state_from_session(age_ms, aborted)

    owner, org = detect_official(agent_id)
    origin = row.get('origin') or {}
    channel = row.get('lastChannel') or origin.get('channel') or '-'
    session_file = row.get('sessionFile', '')
    event_rows = load_session_events(session_file)

    latest_act = '等待指令'
    acts = load_activity(session_file, limit=5, events=event_rows)
    if acts:
        first_act = acts[0]
        if first_act['kind'] == 'tool' and len(acts) > 1:
            for next_act in acts[1:]:
                if next_act['kind'] == 'assistant':
                    latest_act = f"正在执行: {next_act['text'][:80]}"
                    break
            else:
                latest_act = first_act['text'][:60]
        elif first_act['kind'] == 'assistant':
            latest_act = f"思考中: {first_act['text'][:80]}"
        else:
            latest_act = acts[0]['text'][:60]

    title_label = origin.get('label') or session_key
    if re.match(r'agent:\w+:cron:', title_label):
        title = f'{org}定时任务'
    elif re.match(r'agent:\w+:subagent:', title_label):
        title = f'{org}子任务'
    elif title_label == session_key or len(title_label) > 40:
        title = f'{org}会话'
    else:
        title = f'{title_label}'

    reply_meta = build_reply_meta(row, channel, session_file, origin=origin, events=event_rows)

    return {
        'id': f"OC-{agent_id}-{str(session_id)[:8]}",
        'title': title,
        'owner': owner,
        'org': org,
        'state': state,
        'now': latest_act,
        'eta': ms_to_str(updated_at),
        'block': '上次运行中断' if aborted else '无',
        'output': session_file,
        'flow': {
            'draft': f'agent={agent_id}',
            'review': f'updatedAt={ms_to_str(updated_at)}',
            'dispatch': f'sessionKey={session_key}',
        },
        'ac': '来自 OpenClaw runtime sessions 的实时映射',
        'activity': load_activity(session_file, limit=10, events=event_rows),
        'sourceMeta': {
            'agentId': agent_id,
            'sessionKey': session_key,
            'sessionId': session_id,
            'updatedAt': updated_at,
            'ageMs': age_ms,
            'systemSent': bool(row.get('systemSent')),
            'abortedLastRun': aborted,
            'channel': channel,
            'originLabel': origin.get('label'),
            'originChannel': origin.get('channel'),
            'inputTokens': row.get('inputTokens'),
            'outputTokens': row.get('outputTokens'),
            'totalTokens': row.get('totalTokens'),
            'replyMeta': reply_meta,
        },
    }


def main():
    start = time.time()
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    now_ms = int(time.time() * 1000)

    try:
        tasks = []
        scan_files = 0

        if SESSIONS_ROOT.exists():
            for agent_dir in sorted(SESSIONS_ROOT.iterdir()):
                if not agent_dir.is_dir():
                    continue
                agent_id = agent_dir.name
                sessions_file = agent_dir / 'sessions' / 'sessions.json'
                if not sessions_file.exists():
                    continue
                scan_files += 1

                try:
                    raw = json.loads(sessions_file.read_text())
                except Exception:
                    continue

                if not isinstance(raw, dict):
                    continue

                for session_key, row in raw.items():
                    if not isinstance(row, dict):
                        continue
                    tasks.append(build_task(agent_id, session_key, row, now_ms))

        mc_tasks_file = DATA / 'mission_control_tasks.json'
        if mc_tasks_file.exists():
            try:
                mc_tasks = json.loads(mc_tasks_file.read_text())
                if isinstance(mc_tasks, list):
                    tasks.extend(mc_tasks)
            except Exception:
                pass

        manual_tasks_file = DATA / 'manual_parallel_tasks.json'
        if manual_tasks_file.exists():
            try:
                manual_tasks = json.loads(manual_tasks_file.read_text())
                if isinstance(manual_tasks, list):
                    tasks.extend(manual_tasks)
            except Exception:
                pass

        tasks.sort(key=lambda x: x.get('sourceMeta', {}).get('updatedAt', 0), reverse=True)

        seen_ids = set()
        deduped = []
        for task in tasks:
            if task['id'] not in seen_ids:
                seen_ids.add(task['id'])
                deduped.append(task)
        tasks = deduped

        filtered_tasks = []
        one_day_ago = now_ms - 24 * 3600 * 1000
        for task in tasks:
            if str(task['id']).startswith('JJC'):
                filtered_tasks.append(task)
                continue

            updated = task.get('sourceMeta', {}).get('updatedAt', 0)
            title = task.get('title', '')
            if updated < one_day_ago:
                continue
            if '定时任务' in title or '子任务' in title:
                if task.get('state') != 'Blocked':
                    continue
            state = task.get('state')
            if state not in ('Doing', 'Review', 'Blocked'):
                continue
            filtered_tasks.append(task)

        tasks = filtered_tasks

        existing_tasks_file = DATA / 'tasks_source.json'
        if existing_tasks_file.exists():
            try:
                existing = json.loads(existing_tasks_file.read_text())
                jjc_existing = [t for t in existing if str(t.get('id', '')).startswith('JJC')]
                tasks = [t for t in tasks if not str(t.get('id', '')).startswith('JJC')]
                tasks = jjc_existing + tasks
            except Exception as e:
                log.error(f'merge existing JJC tasks failed: {e}')

        atomic_json_write(DATA / 'tasks_source.json', tasks)

        duration_ms = int((time.time() - start) * 1000)
        write_status(
            ok=True,
            lastSyncAt=now,
            durationMs=duration_ms,
            source='openclaw_runtime_sessions',
            recordCount=len(tasks),
            scannedSessionFiles=scan_files,
            missingFields={},
            error=None,
        )
        log.info(f'synced {len(tasks)} tasks from openclaw runtime in {duration_ms}ms')

    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        write_status(
            ok=False,
            lastSyncAt=now,
            durationMs=duration_ms,
            source='openclaw_runtime_sessions',
            recordCount=0,
            missingFields={},
            error=f'{type(e).__name__}: {e}',
            traceback=traceback.format_exc(limit=3),
        )
        raise


if __name__ == '__main__':
    main()
