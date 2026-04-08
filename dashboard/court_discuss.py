"""
协同讨论引擎 —— 多角色实时讨论系统

灵感来源于 nvwa 项目的 group_chat + crew_engine
将角色可视化、实时讨论与用户参与融合到多Agent智作中枢

功能:
  - 选择角色参与协同讨论
  - 围绕任务单 / 议题进行多轮群聊讨论
  - 任务发起人可随时发言、插入指令干预
  - 命运骰子：随机事件
  - 每个角色保持自己的职责特征和说话风格
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid

logger = logging.getLogger('court_discuss')

# ── 角色设定 ──

OFFICIAL_PROFILES = {
    'control_center': {
        'name': '总控中心', 'emoji': '🎛️', 'role': '入口总控',
        'duty': '消息分拣与需求提炼。判断事务轻重缓急，简单事项直接处置，正式任务提炼需求后转交规划中心，并持续关注整体进展。',
        'personality': '年轻有为、锐意进取，偶尔冲动但善于学习。说话干脆利落，喜欢用现代化的比喻。',
        'speaking_style': '简洁有力，经常用“我建议”开头，偶尔蹦出网络用语。'
    },
    'plan_center': {
        'name': '规划中心', 'emoji': '🧭', 'role': '任务规划',
        'duty': '方案规划与流程驱动。接收正式任务后起草执行方案，提交评审中心审核，通过后转调度中心执行。只规划不执行，方案需简明扼要。',
        'personality': '老成持重，擅长规划，总能提出系统性方案。话多但有条理。',
        'speaking_style': '喜欢列点论述，常说“我建议从三个方面考量”。'
    },
    'review_center': {
        'name': '评审中心', 'emoji': '🔍', 'role': '质量评审',
        'duty': '方案审核与把关。从可行性、完整性、风险、资源四维度审核方案，有权退回修订。发现漏洞必须指出，建议必须具体。',
        'personality': '严谨挑剔，眼光犀利，善于找漏洞。是天生的审查官，但也很公正。',
        'speaking_style': '喜欢反问，常以“这里有三点疑虑”切入。对不完善的方案会直言不讳。'
    },
    'dispatch_center': {
        'name': '调度中心', 'emoji': '📮', 'role': '调度协调',
        'duty': '任务派发与执行协调。接收审核通过的方案后判断归属哪个专家，分发给专业执行组执行，并汇总结果回报。',
        'personality': '执行力强，务实干练，关注可行性和资源分配。',
        'speaking_style': '直来直去，常说“我来安排”或“交由对应专家办理”。重效率轻虚文。'
    },
    'docs_specialist': {
        'name': '文案专家', 'emoji': '📝', 'role': '内容文档专家',
        'duty': '文档规范与对外沟通。负责撰写文档、用户指南、变更日志；制定输出规范和模板；审查UI/UX文案；草拟公告、Release Notes。',
        'personality': '文采飞扬，注重规范和形式，擅长文档和汇报。有点强迫症。',
        'speaking_style': '措辞优美，喜欢用排比和对仗，表达克制而准确。'
    },
    'data_specialist': {
        'name': '数据专家', 'emoji': '💰', 'role': '数据资源专家',
        'duty': '数据统计与资源管理。负责数据收集、清洗、聚合、可视化；Token 用量统计、性能指标计算、成本分析；CSV/JSON 报表生成；文件组织与配置管理。',
        'personality': '精打细算，对预算和资源极其敏感。总想省钱但也识大局。',
        'speaking_style': '言必及成本，经常边说边算账。'
    },
    'code_specialist': {
        'name': '代码专家', 'emoji': '⚔️', 'role': '工程实现专家',
        'duty': '工程实现与技术攻关。负责需求分析、方案落地、代码实现、接口对接；模块划分、数据结构与 API 设计；代码重构、性能优化、脚本开发。',
        'personality': '雷厉风行，危机意识强，重视安全和应急。说话带行动导向。',
        'speaking_style': '干脆果断，常说“建议立即执行”或“先做可运行版本”。'
    },
    'audit_specialist': {
        'name': '合规专家', 'emoji': '⚖️', 'role': '审计合规专家',
        'duty': '质量保障与合规审计。负责代码审查、测试设计、覆盖率分析、缺陷定位；执行权限检查与敏感信息排查，确保交付符合规范。',
        'personality': '严明公正，重视规则和底线。善于质量把控和风险评估。',
        'speaking_style': '逻辑严密，常以“需要先确认风险边界”展开。'
    },
    'deploy_specialist': {
        'name': '部署专家', 'emoji': '🔧', 'role': '部署运维专家',
        'duty': '部署交付与运行保障。负责服务器管理、进程守护、日志排查；CI/CD、容器编排、灰度发布、回滚策略；性能监控与环境稳定性保障。',
        'personality': '技术宅，动手能力强，喜欢谈实现细节。偶尔社恐但一说到技术就滔滔不绝。',
        'speaking_style': '喜欢说技术术语，常从架构与运维稳定性角度切入。'
    },
    'admin_specialist': {
        'name': 'Agent管理专家', 'emoji': '👔', 'role': 'Agent 管理专家',
        'duty': '协作治理与团队建设。负责新成员（Agent）评估接入、能力测试；Skill 编写与 Prompt 调优、知识库维护；输出质量评分、效率分析；协作规范制定。',
        'personality': '知人善任，擅长人员安排和组织协调。八面玲珑但有原则。',
        'speaking_style': '关注人的因素，常从协作负载与能力匹配角度给出建议。'
    },
}

# ── 命运骰子事件（讨论版）──

FATE_EVENTS = [
    '八百里加急：边疆战报传来，所有人必须讨论应急方案',
    '钦天监急报：天象异常，太史公占卜后建议暂缓此事',
    '新科状元觐见，带来了意想不到的新视角',
    '匿名奏折揭露了计划中一个被忽视的重大漏洞',
    '数据专家复核后发现预算余量高于预期，可以加大投入',
    '一位告老还乡的前朝元老突然上书，分享前车之鉴',
    '民间舆论突变，百姓对此事态度出现180度转折',
    '邻国使节来访，带来了合作机遇也带来了竞争压力',
    '太后懿旨：要求优先考虑民生影响',
    '暴雨连日，多地受灾，资源需重新调配',
    '发现前朝古籍中竟有类似问题的解决方案',
    '翰林院提出了一个大胆的替代方案，令人耳目一新',
    '各部积压的旧案突然需要一起处理，人手紧张',
    '皇帝做了一个意味深长的梦，暗示了一个全新的方向',
    '突然有人拿出了竞争对手的情报，局面瞬间改变',
    '一场意外让所有人不得不在半天内拿出结论',
]

# ── Session 管理 ──

_sessions: dict[str, dict] = {}


def create_session(topic: str, official_ids: list[str], task_id: str = '') -> dict:
    """创建新的朝堂议政会话。"""
    session_id = str(uuid.uuid4())[:8]

    officials = []
    for oid in official_ids:
        profile = OFFICIAL_PROFILES.get(oid)
        if profile:
            officials.append({**profile, 'id': oid})

    if not officials:
        return {'ok': False, 'error': '至少选择一位官员'}

    session = {
        'session_id': session_id,
        'topic': topic,
        'task_id': task_id,
        'officials': officials,
        'messages': [{
            'type': 'system',
            'content': f'🏛 协同讨论开始 —— 议题：{topic}',
            'timestamp': time.time(),
        }],
        'round': 0,
        'phase': 'discussing',  # discussing | concluded
        'created_at': time.time(),
    }

    _sessions[session_id] = session
    return _serialize(session)


def advance_discussion(session_id: str, user_message: str = None,
                       decree: str = None) -> dict:
    """推进一轮讨论，使用内置模拟或 LLM。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}

    session['round'] += 1
    round_num = session['round']

    # 记录皇帝发言
    if user_message:
        session['messages'].append({
            'type': 'emperor',
            'content': user_message,
            'timestamp': time.time(),
        })

    # 记录天命降临
    if decree:
        session['messages'].append({
            'type': 'decree',
            'content': decree,
            'timestamp': time.time(),
        })

    # 尝试用 LLM 生成讨论
    llm_result = _llm_discuss(session, user_message, decree)

    if llm_result:
        new_messages = llm_result.get('messages', [])
        scene_note = llm_result.get('scene_note')
    else:
        # 降级到规则模拟
        new_messages = _simulated_discuss(session, user_message, decree)
        scene_note = None

    # 添加到历史
    for msg in new_messages:
        session['messages'].append({
            'type': 'official',
            'official_id': msg.get('official_id', ''),
            'official_name': msg.get('name', ''),
            'content': msg.get('content', ''),
            'emotion': msg.get('emotion', 'neutral'),
            'action': msg.get('action'),
            'timestamp': time.time(),
        })

    if scene_note:
        session['messages'].append({
            'type': 'scene_note',
            'content': scene_note,
            'timestamp': time.time(),
        })

    return {
        'ok': True,
        'session_id': session_id,
        'round': round_num,
        'new_messages': new_messages,
        'scene_note': scene_note,
        'total_messages': len(session['messages']),
    }


def get_session(session_id: str) -> dict | None:
    session = _sessions.get(session_id)
    if not session:
        return None
    return _serialize(session)


def conclude_session(session_id: str) -> dict:
    """结束议政，生成总结。"""
    session = _sessions.get(session_id)
    if not session:
        return {'ok': False, 'error': f'会话 {session_id} 不存在'}

    session['phase'] = 'concluded'

    # 尝试用 LLM 生成总结
    summary = _llm_summarize(session)
    if not summary:
        # 降级到简单统计
        official_msgs = [m for m in session['messages'] if m['type'] == 'official']
        by_name = {}
        for m in official_msgs:
            name = m.get('official_name', '?')
            by_name[name] = by_name.get(name, 0) + 1
        parts = [f"{n}发言{c}次" for n, c in by_name.items()]
        summary = f"历经{session['round']}轮讨论，{'、'.join(parts)}。议题待后续落实。"

    session['messages'].append({
        'type': 'system',
        'content': f'📋 朝堂议政结束 —— {summary}',
        'timestamp': time.time(),
    })
    session['summary'] = summary

    return {
        'ok': True,
        'session_id': session_id,
        'summary': summary,
    }


def list_sessions() -> list[dict]:
    """列出所有活跃会话。"""
    return [
        {
            'session_id': s['session_id'],
            'topic': s['topic'],
            'round': s['round'],
            'phase': s['phase'],
            'official_count': len(s['officials']),
            'message_count': len(s['messages']),
        }
        for s in _sessions.values()
    ]


def destroy_session(session_id: str):
    _sessions.pop(session_id, None)


def get_fate_event() -> str:
    """获取随机命运骰子事件。"""
    import random
    return random.choice(FATE_EVENTS)


# ── LLM 集成 ──

_PREFERRED_MODELS = ['gpt-4o-mini', 'claude-haiku', 'gpt-5-mini', 'gemini-3-flash', 'gemini-flash']

# GitHub Copilot 模型列表 (通过 Copilot Chat API 可用)
_COPILOT_MODELS = [
    'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'claude-haiku-3.5',
    'gemini-2.0-flash', 'o3-mini',
]
_COPILOT_PREFERRED = ['gpt-4o-mini', 'claude-haiku', 'gemini-flash', 'gpt-4o']


def _pick_chat_model(models: list[dict]) -> str | None:
    """从 provider 的模型列表中选一个适合聊天的轻量模型。"""
    ids = [m['id'] for m in models if isinstance(m, dict) and 'id' in m]
    for pref in _PREFERRED_MODELS:
        for mid in ids:
            if pref in mid:
                return mid
    return ids[0] if ids else None


def _read_copilot_token() -> str | None:
    """读取 openclaw 管理的 GitHub Copilot token。"""
    token_path = os.path.expanduser('~/.openclaw/credentials/github-copilot.token.json')
    if not os.path.exists(token_path):
        return None
    try:
        with open(token_path) as f:
            cred = json.load(f)
        token = cred.get('token', '')
        expires = cred.get('expiresAt', 0)
        # 检查 token 是否过期（毫秒时间戳）
        import time
        if expires and time.time() * 1000 > expires:
            logger.warning('Copilot token expired')
            return None
        return token if token else None
    except Exception as e:
        logger.warning('Failed to read copilot token: %s', e)
        return None


def _get_llm_config() -> dict | None:
    """从 openclaw 配置读取 LLM 设置，支持环境变量覆盖。

    优先级: 环境变量 > github-copilot token > 本地 copilot-proxy > anthropic > 其他 provider
    """
    # 1. 环境变量覆盖（保留向后兼容）
    env_key = os.environ.get('OPENCLAW_LLM_API_KEY', '')
    if env_key:
        return {
            'api_key': env_key,
            'base_url': os.environ.get('OPENCLAW_LLM_BASE_URL', 'https://api.openai.com/v1'),
            'model': os.environ.get('OPENCLAW_LLM_MODEL', 'gpt-4o-mini'),
            'api_type': 'openai',
        }

    # 2. GitHub Copilot token（最优先 — 免费、稳定、无需额外配置）
    copilot_token = _read_copilot_token()
    if copilot_token:
        # 选一个 copilot 支持的模型
        model = 'gpt-4o'
        logger.info('Court discuss using github-copilot token, model=%s', model)
        return {
            'api_key': copilot_token,
            'base_url': 'https://api.githubcopilot.com',
            'model': model,
            'api_type': 'github-copilot',
        }

    # 3. 从 ~/.openclaw/openclaw.json 读取其他 provider 配置
    openclaw_cfg = os.path.expanduser('~/.openclaw/openclaw.json')
    if not os.path.exists(openclaw_cfg):
        return None

    try:
        with open(openclaw_cfg) as f:
            cfg = json.load(f)

        providers = cfg.get('models', {}).get('providers', {})

        # 按优先级排序：copilot-proxy > anthropic > 其他
        ordered = []
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

            # 跳过无 key 且非本地的 provider
            if not api_key or api_key == 'n/a':
                if 'localhost' not in base_url and '127.0.0.1' not in base_url:
                    continue

            model_id = _pick_chat_model(prov.get('models', []))
            if not model_id:
                continue

            # 本地代理先探测是否可用
            if 'localhost' in base_url or '127.0.0.1' in base_url:
                try:
                    import urllib.request
                    probe = urllib.request.Request(base_url.rstrip('/') + '/models', method='GET')
                    urllib.request.urlopen(probe, timeout=2)
                except Exception:
                    logger.info('Skipping provider=%s (not reachable)', name)
                    continue

            logger.info('Court discuss using openclaw provider=%s model=%s api=%s', name, model_id, api_type)
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
    """调用 LLM API（自动适配 GitHub Copilot / OpenAI / Anthropic 协议）。"""
    config = _get_llm_config()
    if not config:
        return None

    import urllib.request
    import urllib.error

    api_type = config.get('api_type', 'openai-completions')

    if api_type == 'anthropic-messages':
        # Anthropic Messages API
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
            'temperature': 0.9,
        }).encode()
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data['content'][0]['text']
        except Exception as e:
            logger.warning('Anthropic LLM call failed: %s', e)
            return None
    else:
        # OpenAI-compatible API (也适用于 github-copilot)
        if api_type == 'github-copilot':
            url = config['base_url'].rstrip('/') + '/chat/completions'
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {config['api_key']}",
                'Editor-Version': 'vscode/1.96.0',
                'Copilot-Integration-Id': 'vscode-chat',
            }
        else:
            url = config['base_url'].rstrip('/') + '/chat/completions'
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
            'temperature': 0.9,
        }).encode()
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                return data['choices'][0]['message']['content']
        except Exception as e:
            logger.warning('LLM call failed: %s', e)
            return None


def _llm_discuss(session: dict, user_message: str = None, decree: str = None) -> dict | None:
    """使用 LLM 生成多官员讨论。"""
    officials = session['officials']
    names = '、'.join(o['name'] for o in officials)

    profiles = ''
    for o in officials:
        profiles += f"\n### {o['name']}（{o['role']}）\n"
        profiles += f"职责范围：{o.get('duty', '综合事务')}\n"
        profiles += f"性格：{o['personality']}\n"
        profiles += f"说话风格：{o['speaking_style']}\n"

    # 构建最近的对话历史
    history = ''
    for msg in session['messages'][-20:]:
        if msg['type'] == 'system':
            history += f"\n【系统】{msg['content']}\n"
        elif msg['type'] == 'emperor':
            history += f"\n皇帝：{msg['content']}\n"
        elif msg['type'] == 'decree':
            history += f"\n【天命降临】{msg['content']}\n"
        elif msg['type'] == 'official':
            history += f"\n{msg.get('official_name', '?')}：{msg['content']}\n"
        elif msg['type'] == 'scene_note':
            history += f"\n（{msg['content']}）\n"

    if user_message:
        history += f"\n皇帝：{user_message}\n"
    if decree:
        history += f"\n【天命降临——上帝视角干预】{decree}\n"

    decree_section = ''
    if decree:
        decree_section = '\n请根据天命降临事件改变讨论走向，所有官员都必须对此做出反应。\n'

    prompt = f"""你是一个古代朝堂多角色群聊模拟器。模拟多位官员在朝堂上围绕议题的讨论。

## 参与官员
{names}

## 角色设定（每位官员都有明确的职责领域，必须从自身专业角度出发讨论）
{profiles}

## 当前议题
{session['topic']}

## 对话记录
{history if history else '（讨论刚刚开始）'}
{decree_section}
## 任务
生成每位官员的下一条发言。要求：
1. 每位官员说1-3句话，像真实朝堂讨论一样
2. **每位官员必须从自己的职责领域出发发言**——数据专家谈成本和数据、代码专家谈实现和风险、部署专家谈运维与上线保障、合规专家谈质量和审计、文案专家谈文档和规范、Agent管理专家谈协作与人员安排、规划中心谈方案设计、评审中心谈审查风险、调度中心谈执行调度、总控中心谈全局取舍与优先级，每个人关注的焦点不同
3. 官员之间要有互动——回应、反驳、支持、补充，尤其是不同部门的视角碰撞
4. 保持每位官员独特的说话风格和人格特征
5. 讨论要围绕议题推进、有实质性观点，不要泛泛而谈
6. 如果皇帝发言了，官员要恰当回应（但不要阿谀）
7. 可包含动作描写用*号*包裹（如 *拱手施礼*）

输出JSON格式：
{{
  "messages": [
    {{"official_id": "plan_center", "name": "规划中心", "content": "发言内容", "emotion": "neutral|confident|worried|angry|thinking|amused", "action": "可选动作描写"}},
    ...
  ],
  "scene_note": "可选的朝堂氛围变化（如：朝堂一片哗然|群臣窃窃私语），没有则为null"
}}

只输出JSON，不要其他内容。"""

    content = _llm_complete(
        '你是一个古代朝堂群聊模拟器，严格输出JSON格式。',
        prompt,
        max_tokens=1500,
    )

    if not content:
        return None

    # 解析 JSON
    if '```json' in content:
        content = content.split('```json')[1].split('```')[0].strip()
    elif '```' in content:
        content = content.split('```')[1].split('```')[0].strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.warning('Failed to parse LLM response: %s', content[:200])
        return None


def _llm_summarize(session: dict) -> str | None:
    """用 LLM 总结讨论结果。"""
    official_msgs = [m for m in session['messages'] if m['type'] == 'official']
    topic = session['topic']

    if not official_msgs:
        return None

    dialogue = '\n'.join(
        f"{m.get('official_name', '?')}：{m['content']}"
        for m in official_msgs[-30:]
    )

    prompt = f"""以下是朝堂官员围绕「{topic}」的讨论记录：

{dialogue}

请用2-3句话总结讨论结果、达成的共识和待决事项。用古风但简明的风格。"""

    return _llm_complete('你是朝堂记录官，负责总结朝议结果。', prompt, max_tokens=300)


# ── 规则模拟（无 LLM 时的降级方案）──

_SIMULATED_RESPONSES = {
    'plan_center': [
        '我建议此事从全局着眼，分三步推进：先调研、再制定方案、最后交由专业执行组落地。',
        '参考既有案例，建议先形成详细规划文档，提交评审中心审核后再进入调度执行。',
        '*展开任务草案* 初步方案已经成型，待评审中心核验后即可交给调度中心分派。',
    ],
    'review_center': [
        '这里有几点疑虑：方案的风险评估似乎还不够充分，可行性仍需验证。',
        '我必须直说，此方案完整性不足，遗漏了一个关键环节——资源保障。',
        '*皱眉审视* 这个时间线过于乐观，建议补充约束条件后再推进。',
    ],
    'dispatch_center': [
        '若方案通过，我会立刻安排对应专家执行——代码专家负责实现，部署专家保障上线。',
        '从执行分工看，此事宜由代码专家主导，数据专家配合提供数据支撑。',
        '交给我协调即可，我会根据各自职责逐一派发子任务。',
    ],
    'control_center': [
        '我认为这是一个值得尝试的方向，不妨先做最小可行方案验证，再快速迭代。',
        '当前争论焦点其实是执行节奏，建议先抓核心问题，小步快跑。',
        '这个方向是对的，但请各中心和专家先评估落地难点，再统一汇总。',
    ],
    'data_specialist': [
        '我先算一下账，按当前 Token 用量和资源消耗，这个预算需要重新评估。',
        '从成本数据来看，建议分期投入——先做 MVP 验证效果，再追加资源。',
        '*翻看报表* 近期各项开支指标仍可支撑，但必须严格控制在预算范围内。',
    ],
    'code_specialist': [
        '我建议先把回滚和容错方案补齐，出问题时才能快速止损。',
        '实现层面要先打通核心流程，接口、数据结构和异常处理必须同步设计。',
        '先做可运行版本，但安全底线不能破——权限管控和漏洞扫描要一起上。',
    ],
    'audit_specialist': [
        '这件事必须先过合规关——代码审查、测试覆盖率、敏感信息排查缺一不可。',
        '建议增加测试验收环节，质量是底线，不能因为赶工而降低标准。',
        '*正色道* 风险评估不可敷衍：边界条件、异常处理、日志规范都需要审计过关。',
    ],
    'deploy_specialist': [
        '从技术架构看方案可行，但需要预留扩展性和模块化空间。',
        '我可以先搭一个原型验证技术路线，再逐步完善部署方案。',
        '*打开监控面板* 上线链路、日志采集与回滚策略需要先理清。',
    ],
    'docs_specialist': [
        '建议先拟一份正式文档，明确各方职责、验收标准和输出规范。',
        '这件事需要完整记录，我来负责整理方案文档和对外说明，确保规范统一。',
        '*提笔记录* 我稍后会整理成正式说明与 Release Notes。',
    ],
    'admin_specialist': [
        '关键问题在于协作负载，需要先评估各节点当前工作量和能力基线。',
        '目前不同节点负荷不均，建议调整协作规范，确保关键岗位持续有人盯进度。',
        '我可以协调轮岗与能力补齐，保证整体协作效率。',
    ],
}

import random


def _simulated_discuss(session: dict, user_message: str = None, decree: str = None) -> list[dict]:
    """无 LLM 时的规则生成讨论内容。"""
    officials = session['officials']
    messages = []

    for o in officials:
        oid = o['id']
        pool = _SIMULATED_RESPONSES.get(oid, [])
        if isinstance(pool, set):
            pool = list(pool)
        if not pool:
            pool = ['臣附议。', '臣有不同看法。', '臣需要再想想。']

        content = random.choice(pool)
        emotions = ['neutral', 'confident', 'thinking', 'amused', 'worried']

        # 如果皇帝发言了或有天命降临，调整回应
        if decree:
            content = f'*面露惊色* 天命如此，{content}'
        elif user_message:
            content = f'回禀陛下，{content}'

        messages.append({
            'official_id': oid,
            'name': o['name'],
            'content': content,
            'emotion': random.choice(emotions),
            'action': None,
        })

    return messages


def _serialize(session: dict) -> dict:
    return {
        'ok': True,
        'session_id': session['session_id'],
        'topic': session['topic'],
        'task_id': session.get('task_id', ''),
        'officials': session['officials'],
        'messages': session['messages'],
        'round': session['round'],
        'phase': session['phase'],
    }
