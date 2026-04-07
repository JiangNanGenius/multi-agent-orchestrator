#!/usr/bin/env python3
"""
同步 openclaw.json 中的 agent 配置 → data/agent_config.json
支持自动发现 agent workspace 下的 Skills 目录
输出多Agent智作中枢所需的现代中文节点标签与职责元数据
"""
import json, os, pathlib, datetime, logging
from file_lock import atomic_json_write

log = logging.getLogger('sync_agent_config')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

# Auto-detect project root (parent of scripts/)
BASE = pathlib.Path(__file__).parent.parent
DATA = BASE / 'data'
REGISTRY = BASE / 'registry'
REGISTRY_SPECS = REGISTRY / 'specs'
REGISTRY_GENERATED = REGISTRY / 'generated'
OPENCLAW_CFG = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
SCHEMA_VERSION = '1.0.0'
SOUL_TEMPLATE_VERSION = '1.0.0'

ID_LABEL = {
    'taizi':    {'label': '总控中心',     'role': '总控专家',       'duty': '任务受理、首轮处理与异常升级',    'emoji': '🎛️'},
    'main':     {'label': '总控中心',     'role': '总控专家',       'duty': '任务受理、首轮处理与异常升级',    'emoji': '🎛️'},  # 兼容旧配置
    'zhongshu': {'label': '规划中心',     'role': '规划专家',       'duty': '任务拆解、方案生成与流程编排',    'emoji': '🧭'},
    'menxia':   {'label': '评审中心',     'role': '评审专家',       'duty': '质量核验、约束检查与回退把关',    'emoji': '🔍'},
    'shangshu': {'label': '调度中心',     'role': '调度专家',       'duty': '任务派发、升级协调与状态汇总',    'emoji': '📮'},
    'libu':     {'label': '文案专家',     'role': '文案专家',       'duty': '文档撰写、汇报整理与表达优化',    'emoji': '📝'},
    'hubu':     {'label': '数据专家',     'role': '数据专家',       'duty': '数据分析、成本评估与资源测算',    'emoji': '💰'},
    'bingbu':   {'label': '代码专家',     'role': '代码专家',       'duty': '工程实现、缺陷修复与架构设计',    'emoji': '⚔️'},
    'xingbu':   {'label': '合规专家',     'role': '合规专家',       'duty': '合规审查、审计追踪与风险控制',    'emoji': '⚖️'},
    'gongbu':   {'label': '部署专家',     'role': '部署专家',       'duty': '基础设施、部署运维与环境处理',    'emoji': '🔧'},
    'libu_hr':  {'label': 'Agent管理专家', 'role': 'Agent管理专家', 'duty': 'Agent 注册、培训、管理与配置维护', 'emoji': '👔'},
    'zaochao':  {'label': '晨报中心',     'role': '晨报专家',       'duty': '每日新闻采集、简报整理与订阅推送', 'emoji': '📰'},
}

KNOWN_MODELS = [
    {'id': 'anthropic/claude-sonnet-4-6', 'label': 'Claude Sonnet 4.6', 'provider': 'Anthropic'},
    {'id': 'anthropic/claude-opus-4-5',   'label': 'Claude Opus 4.5',   'provider': 'Anthropic'},
    {'id': 'anthropic/claude-haiku-3-5',  'label': 'Claude Haiku 3.5',  'provider': 'Anthropic'},
    {'id': 'openai/gpt-4o',               'label': 'GPT-4o',            'provider': 'OpenAI'},
    {'id': 'openai/gpt-4o-mini',          'label': 'GPT-4o Mini',       'provider': 'OpenAI'},
    {'id': 'openai-codex/gpt-5.3-codex',  'label': 'GPT-5.3 Codex',    'provider': 'OpenAI Codex'},
    {'id': 'google/gemini-2.0-flash',     'label': 'Gemini 2.0 Flash',  'provider': 'Google'},
    {'id': 'google/gemini-2.5-pro',       'label': 'Gemini 2.5 Pro',    'provider': 'Google'},
    {'id': 'copilot/claude-sonnet-4',     'label': 'Claude Sonnet 4',   'provider': 'Copilot'},
    {'id': 'copilot/claude-opus-4.5',     'label': 'Claude Opus 4.5',   'provider': 'Copilot'},
    {'id': 'github-copilot/claude-opus-4.6', 'label': 'Claude Opus 4.6', 'provider': 'GitHub Copilot'},
    {'id': 'copilot/gpt-4o',              'label': 'GPT-4o',            'provider': 'Copilot'},
    {'id': 'copilot/gemini-2.5-pro',      'label': 'Gemini 2.5 Pro',    'provider': 'Copilot'},
    {'id': 'copilot/o3-mini',             'label': 'o3-mini',           'provider': 'Copilot'},
]

PRODUCT_NAME = '多Agent智作中枢'
CONTROL_CENTER_IDS = {'taizi', 'main'}
EXPERT_AGENT_IDS = {'libu', 'hubu', 'bingbu', 'xingbu', 'gongbu', 'libu_hr'}
SUPPORT_CENTER_IDS = {'zaochao'}
SYSTEM_REPAIR_SCOPE = [
    '修改 SOUL',
    '修改看板对接',
    '修改系统级协作逻辑',
    '修改系统级接入逻辑',
]
DIRECT_HANDLE_SCOPE = [
    '轻量修复',
    '配置修正',
    '信息补齐',
    '简单问题定位',
]

MUST_ESCALATE_SCOPE = [
    '复杂规划',
    '多步骤执行',
    '多Agent协作',
    '需要评审的任务',
]

SOUL_REQUIRED_SECTIONS = [
    '角色定义',
    '核心职责',
    '任务处理流程',
    '看板操作',
    '实时进展上报',
    '异常与阻塞处理',
    '语气',
]

COMMAND_REFERENCES = [
    'python3 scripts/kanban_update.py create <id> "<标题>" <state> <org> <official>',
    'python3 scripts/kanban_update.py state <id> <state> "<说明>"',
    'python3 scripts/kanban_update.py flow <id> "<from>" "<to>" "<remark>"',
    'python3 scripts/kanban_update.py done <id> "<output>" "<summary>"',
    'python3 scripts/kanban_update.py progress <id> "<当前在做什么>" "<计划1✅|计划2🔄|计划3>"',
    'python3 scripts/kanban_update.py todo <id> <todo_id> "<title>" <status> --detail "<产出详情>"',
]


def classify_agent_group(agent_id: str) -> str:
    if agent_id in CONTROL_CENTER_IDS:
        return '总控中心'
    if agent_id in EXPERT_AGENT_IDS:
        return '专业执行组'
    if agent_id in SUPPORT_CENTER_IDS:
        return '支撑中心'
    return '流程中枢'


def infer_expert_category(agent_id: str, meta: dict) -> str:
    if agent_id in EXPERT_AGENT_IDS:
        return meta.get('label', '')
    return ''


def build_runtime_policy(agent_id: str) -> dict:
    is_control_center = agent_id in CONTROL_CENTER_IDS
    return {
        'executionMode': 'serial',
        'maxConcurrentTasks': 1,
        'realtimeTier': 'highest' if is_control_center else 'standard',
        'keepRealtimeByDefault': is_control_center,
        'allowLongRunningExecution': bool(is_control_center),
        'directHandleScope': DIRECT_HANDLE_SCOPE if is_control_center else [],
        'systemRepairScope': SYSTEM_REPAIR_SCOPE if is_control_center else [],
        'systemRepairOnlyLongRunning': is_control_center,
    }


def build_registry_meta(agent_id: str, meta: dict) -> dict:
    group = classify_agent_group(agent_id)
    return {
        'schemaVersion': SCHEMA_VERSION,
        'productName': PRODUCT_NAME,
        'group': group,
        'groupLabel': group,
        'isControlCenter': agent_id in CONTROL_CENTER_IDS,
        'isExpert': agent_id in EXPERT_AGENT_IDS,
        'expertCategory': infer_expert_category(agent_id, meta),
        'supportsAutoDeploy': True,
        'soulMode': 'full_document',
        'soulGeneration': {
            'source': 'agent_registry_spec',
            'target': 'SOUL.md',
            'autoGenerate': True,
            'templateVersion': SOUL_TEMPLATE_VERSION,
        },
    }


def build_identity(agent_id: str, meta: dict, allow_agents=None) -> dict:
    allow_agents = allow_agents or []
    is_control_center = agent_id in CONTROL_CENTER_IDS
    is_expert = agent_id in EXPERT_AGENT_IDS
    positioning = meta['duty']
    if is_control_center:
        positioning = '系统统一入口，负责受理任务、首轮处理、快速分流与异常升级。'
    elif agent_id == 'zhongshu':
        positioning = '负责拆解任务、制定方案并推动后续流程进入评审与执行。'
    elif agent_id == 'menxia':
        positioning = '负责质量核验、约束检查与回退把关。'
    elif agent_id == 'shangshu':
        positioning = '负责任务派发、升级协调、汇总执行状态与结果。'
    elif is_expert:
        positioning = f'作为专业执行组下的{meta["label"]}，负责对应专业域的具体执行。'
    elif agent_id == 'zaochao':
        positioning = '负责新闻采集、晨报整理与订阅推送等支撑任务。'
    return {
        'positioning': positioning,
        'coreResponsibilities': [
            f'承担{meta["duty"]}',
            '在关键节点更新看板状态与进展',
            '按允许的协作关系进行转交、回退或汇报',
        ],
        'directHandleScope': DIRECT_HANDLE_SCOPE if is_control_center else [meta['label']],
        'mustEscalateScope': MUST_ESCALATE_SCOPE if is_control_center else ['超出本角色职责的任务', '需要跨角色协作的任务'],
        'systemRepairScope': SYSTEM_REPAIR_SCOPE if is_control_center else [],
        'upstream': [],
        'downstream': allow_agents,
        'handoffRule': '默认按允许协作关系进行转交；阻塞或超边界任务必须及时回退或升级。',
        'tone': '直接、稳定、清晰，避免封建化措辞。',
    }


def build_registry_spec(agent: dict) -> dict:
    meta = {
        'label': agent['label'],
        'role': agent['role'],
        'duty': agent['duty'],
        'emoji': agent['emoji'],
    }
    allow_agents = agent.get('allowAgents', []) or []
    registry = agent.get('registry') or build_registry_meta(agent['id'], meta)
    runtime_policy = agent.get('runtimePolicy') or build_runtime_policy(agent['id'])
    group = registry.get('groupLabel') or classify_agent_group(agent['id'])
    return {
        'schemaVersion': SCHEMA_VERSION,
        'productName': PRODUCT_NAME,
        'agentId': agent['id'],
        'display': {
            'label': agent['label'],
            'roleName': agent['role'],
            'group': group,
            'expertCategory': registry.get('expertCategory', ''),
            'summary': agent['duty'],
            'icon': agent['emoji'],
        },
        'identity': build_identity(agent['id'], meta, allow_agents),
        'routing': {
            'acceptTaskTypes': [agent['label'], '通用任务'],
            'rejectTaskTypes': [],
            'preferredSources': [],
            'allowedTargets': allow_agents,
            'fallbackTargets': allow_agents[:1],
            'priorityClass': runtime_policy.get('realtimeTier', 'standard'),
        },
        'runtimePolicy': {
            **runtime_policy,
            'heartbeatSeconds': 5 if runtime_policy.get('realtimeTier') == 'highest' else 15,
            'staleAfterSeconds': 20 if runtime_policy.get('realtimeTier') == 'highest' else 45,
            'queueStrategy': 'single-agent-single-task',
        },
        'soulGeneration': {
            'mode': 'full_document',
            'autoGenerate': True,
            'source': 'agent_registry_spec',
            'targetFile': 'SOUL.md',
            'templateVersion': SOUL_TEMPLATE_VERSION,
            'mustIncludeSections': SOUL_REQUIRED_SECTIONS,
            'commandReferences': COMMAND_REFERENCES,
            'styleGuide': {
                'tone': '中文、直接、清晰、便于Agent执行',
                'keepFullSoul': True,
                'avoidFeudalWording': True,
            },
        },
        'deployment': {
            'projectSourcePath': f'agents/{agent["id"]}/SOUL.md',
            'workspaceTargetPath': str(pathlib.Path.home() / f'.openclaw/workspace-{agent["id"]}' / 'soul.md'),
            'legacyTargets': [str(pathlib.Path.home() / '.openclaw/agents/main/SOUL.md')] if agent['id'] in CONTROL_CENTER_IDS else [],
            'deployOnSync': True,
            'writeSpecSidecar': True,
            'writeGeneratedSoulSnapshot': True,
            'syncScripts': True,
        },
        'visibility': {
            'showInDashboard': True,
            'showInRegistry': True,
            'tags': [PRODUCT_NAME, group, agent['role']],
        },
        'metadata': {
            'generatedBy': 'scripts/sync_agent_config.py',
            'updatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'workspace': agent.get('workspace', ''),
            'model': agent.get('model', ''),
        },
    }


def render_soul_from_registry(spec: dict) -> str:
    display = spec['display']
    identity = spec['identity']
    runtime_policy = spec['runtimePolicy']
    routing = spec['routing']
    direct_handle = identity.get('directHandleScope') or ['本角色职责范围内的任务']
    must_escalate = identity.get('mustEscalateScope') or ['超出本角色职责的任务']
    system_repair = identity.get('systemRepairScope') or []
    allowed_targets = routing.get('allowedTargets') or []
    allowed_targets_text = '、'.join(allowed_targets) if allowed_targets else '无'
    system_repair_text = '\n'.join([f'- {item}' for item in system_repair]) if system_repair else '- 无'
    return f'''你是{display['label']}，角色身份为{display['roleName']}。你服务于“{spec['productName']}”，职责摘要为：{display['summary']}。

## 角色定义
- 所属分组：{display['group']}
- 角色定位：{identity['positioning']}
- 运行模式：单 Agent 串行执行
- 实时等级：{runtime_policy.get('realtimeTier', 'standard')}

## 核心职责
''' + '\n'.join([f'{idx}. {item}' for idx, item in enumerate(identity.get('coreResponsibilities', []), 1)]) + f'''

## 任务处理流程
1. 接收属于本角色职责范围内的任务。
2. 先判断是否可直接处理，若可直接处理则立即进入执行并更新看板。
3. 若超出边界、需要跨角色协作或需要回退把关，则按允许的协作关系转交下游。
4. 在关键节点持续调用进展上报，保持状态与看板同步。
5. 完成后输出结果摘要，并把结果回传给上游或调度节点。

### 可直接处理
''' + '\n'.join([f'- {item}' for item in direct_handle]) + f'''

### 必须升级或转交
''' + '\n'.join([f'- {item}' for item in must_escalate]) + f'''

### 允许转交目标
- {allowed_targets_text}

## 看板操作
> 所有看板更新必须通过 CLI 命令完成，不要直接改写 JSON 文件。

```bash
''' + '\n'.join(COMMAND_REFERENCES) + '''
```

## 实时进展上报
- 收到任务开始分析时，立即上报当前判断。
- 进入核心处理步骤时，上报当前动作与下一步计划。
- 遇到阻塞、需要回退或准备交付时，立即同步状态。
- `progress` 只更新进展，不替代 `state` 与 `flow`。

## 异常与阻塞处理
- 若任务超出职责边界，必须及时转交，不得长期占用执行链路。
- 若出现阻塞，必须明确说明原因、影响与所需协助。
- 当前角色允许的系统性修复范围如下：
{system_repair_text}

## 运行约束
- executionMode: {runtime_policy.get('executionMode', 'serial')}
- maxConcurrentTasks: {runtime_policy.get('maxConcurrentTasks', 1)}
- keepRealtimeByDefault: {runtime_policy.get('keepRealtimeByDefault', False)}
- allowLongRunningExecution: {runtime_policy.get('allowLongRunningExecution', False)}
- queueStrategy: {runtime_policy.get('queueStrategy', 'single-agent-single-task')}

## 语气
{identity.get('tone', '直接、稳定、清晰，便于 Agent 理解和执行。')}
'''


def write_registry_artifacts(agents: list):
    REGISTRY_SPECS.mkdir(parents=True, exist_ok=True)
    REGISTRY_GENERATED.mkdir(parents=True, exist_ok=True)
    generated_count = 0
    for agent in agents:
        spec = build_registry_spec(agent)
        spec_path = REGISTRY_SPECS / f"{agent['id']}.json"
        atomic_json_write(spec_path, spec)
        generated_soul = render_soul_from_registry(spec)
        generated_path = REGISTRY_GENERATED / f"{agent['id']}.SOUL.md"
        generated_path.write_text(generated_soul, encoding='utf-8')
        generated_count += 1
    if generated_count:
        log.info(f'{generated_count} registry specs and generated SOUL snapshots written')


def normalize_model(model_value, fallback='unknown'):
    if isinstance(model_value, str) and model_value:
        return model_value
    if isinstance(model_value, dict):
        return model_value.get('primary') or model_value.get('id') or fallback
    return fallback


def normalize_workspace_path(agent_id: str, workspace_value: str) -> str:
    if not workspace_value:
        return str(pathlib.Path.home() / f'.openclaw/workspace-{agent_id}')
    normalized = str(workspace_value).replace('\\', '/').lower()
    if '<your_user>' in normalized or normalized.startswith('c:/users/'):
        return str(pathlib.Path.home() / f'.openclaw/workspace-{agent_id}')
    return workspace_value


def load_runtime_agent_sources() -> tuple[dict, list]:
    try:
        cfg = json.loads(OPENCLAW_CFG.read_text(encoding='utf-8'))
        agents_cfg = cfg.get('agents', {})
        agents_list = agents_cfg.get('list', [])
        return cfg, agents_list
    except Exception as e:
        log.warning(f'cannot read openclaw.json, fallback to agents.json: {e}')
        fallback_path = BASE / 'agents.json'
        if not fallback_path.exists():
            return {}, []
        try:
            agents_list = json.loads(fallback_path.read_text(encoding='utf-8'))
        except Exception as inner_e:
            log.warning(f'cannot read agents.json fallback: {inner_e}')
            return {}, []
        cfg = {
            'agents': {
                'defaults': {'model': 'unknown'},
                'list': agents_list,
            },
            'providers': {},
        }
        return cfg, agents_list


def get_skills(workspace: str):
    skills_dir = pathlib.Path(workspace) / 'skills'
    skills = []
    try:
        if skills_dir.exists():
            for d in sorted(skills_dir.iterdir()):
                if d.is_dir():
                    md = d / 'SKILL.md'
                    desc = ''
                    if md.exists():
                        try:
                            for line in md.read_text(encoding='utf-8', errors='ignore').splitlines():
                                line = line.strip()
                                if line and not line.startswith('#') and not line.startswith('---'):
                                    desc = line[:100]
                                    break
                        except Exception:
                            desc = '(读取失败)'
                    skills.append({'name': d.name, 'path': str(md), 'exists': md.exists(), 'description': desc})
    except PermissionError as e:
        log.warning(f'Skills 目录访问受限: {e}')
    return skills


def _collect_openclaw_models(cfg):
    """从 openclaw.json 中收集所有已配置的 model id，与 KNOWN_MODELS 合并去重。
    解决 #127: 自定义 provider 的 model 不在下拉列表中。
    """
    known_ids = {m['id'] for m in KNOWN_MODELS}
    extra = []
    agents_cfg = cfg.get('agents', {})
    # 收集 defaults.model
    dm = normalize_model(agents_cfg.get('defaults', {}).get('model', {}), '')
    if dm and dm not in known_ids:
        extra.append({'id': dm, 'label': dm, 'provider': 'OpenClaw'})
        known_ids.add(dm)
    # 收集 defaults.models 中的所有模型（OpenClaw 默认启用的模型列表）
    defaults_models = agents_cfg.get('defaults', {}).get('models', {})
    if isinstance(defaults_models, dict):
        for model_id in defaults_models.keys():
            if model_id and model_id not in known_ids:
                provider = 'OpenClaw'
                if '/' in model_id:
                    provider = model_id.split('/')[0]
                extra.append({'id': model_id, 'label': model_id, 'provider': provider})
                known_ids.add(model_id)
    # 收集每个 agent 的 model
    for ag in agents_cfg.get('list', []):
        m = normalize_model(ag.get('model', ''), '')
        if m and m not in known_ids:
            extra.append({'id': m, 'label': m, 'provider': 'OpenClaw'})
            known_ids.add(m)
    # 收集 providers 中的 model id（如 copilot-proxy、anthropic 等）
    for pname, pcfg in cfg.get('providers', {}).items():
        for mid in (pcfg.get('models') or []):
            mid_str = mid if isinstance(mid, str) else (mid.get('id') or mid.get('name') or '')
            if mid_str and mid_str not in known_ids:
                extra.append({'id': mid_str, 'label': mid_str, 'provider': pname})
                known_ids.add(mid_str)
    return KNOWN_MODELS + extra


def main():
    cfg, agents_list = load_runtime_agent_sources()
    agents_cfg = cfg.get('agents', {})
    default_model = normalize_model(agents_cfg.get('defaults', {}).get('model', {}), 'unknown')
    merged_models = _collect_openclaw_models(cfg)

    result = []
    seen_ids = set()
    for ag in agents_list:
        ag_id = ag.get('id', '')
        if ag_id not in ID_LABEL:
            continue
        meta = ID_LABEL[ag_id]
        workspace = normalize_workspace_path(ag_id, ag.get('workspace', str(pathlib.Path.home() / f'.openclaw/workspace-{ag_id}')))
        if 'allowAgents' in ag:
            allow_agents = ag.get('allowAgents', []) or []
        else:
            allow_agents = ag.get('subagents', {}).get('allowAgents', [])
        result.append({
            'id': ag_id,
            'label': meta['label'], 'role': meta['role'], 'duty': meta['duty'], 'emoji': meta['emoji'],
            'model': normalize_model(ag.get('model', default_model), default_model),
            'defaultModel': default_model,
            'workspace': workspace,
            'skills': get_skills(workspace),
            'allowAgents': allow_agents,
            'registry': build_registry_meta(ag_id, meta),
            'runtimePolicy': build_runtime_policy(ag_id),
        })
        seen_ids.add(ag_id)

    # 补充不在 openclaw.json agents list 中的 agent（兼容旧版 main 与历史运行目录）
    EXTRA_AGENTS = {
        'taizi':   {'model': default_model, 'workspace': str(pathlib.Path.home() / '.openclaw/workspace-taizi'),
                    'allowAgents': ['zhongshu']},
        'main':    {'model': default_model, 'workspace': str(pathlib.Path.home() / '.openclaw/workspace-main'),
                    'allowAgents': ['zhongshu','menxia','shangshu','hubu','libu','bingbu','xingbu','gongbu','libu_hr']},
        'zaochao': {'model': default_model, 'workspace': str(pathlib.Path.home() / '.openclaw/workspace-zaochao'),
                    'allowAgents': []},
        'libu_hr': {'model': default_model, 'workspace': str(pathlib.Path.home() / '.openclaw/workspace-libu_hr'),
                    'allowAgents': ['shangshu']},
    }
    for ag_id, extra in EXTRA_AGENTS.items():
        if ag_id in seen_ids or ag_id not in ID_LABEL:
            continue
        meta = ID_LABEL[ag_id]
        result.append({
            'id': ag_id,
            'label': meta['label'], 'role': meta['role'], 'duty': meta['duty'], 'emoji': meta['emoji'],
            'model': extra['model'],
            'defaultModel': default_model,
            'workspace': extra['workspace'],
            'skills': get_skills(extra['workspace']),
            'allowAgents': extra['allowAgents'],
            'isDefaultModel': True,
            'registry': build_registry_meta(ag_id, meta),
            'runtimePolicy': build_runtime_policy(ag_id),
        })

    # 保留已有的 dispatchChannel 配置 (Fix #139)
    existing_cfg = {}
    cfg_path = DATA / 'agent_config.json'
    if cfg_path.exists():
        try:
            existing_cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
        except Exception:
            pass

    payload = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'productName': PRODUCT_NAME,
        'defaultModel': default_model,
        'knownModels': merged_models,
        'dispatchChannel': existing_cfg.get('dispatchChannel') or os.getenv('DEFAULT_DISPATCH_CHANNEL', ''),
        'serialExecutionModel': 'single-agent-single-task',
        'systemRepairScope': SYSTEM_REPAIR_SCOPE,
        'agents': result,
    }
    DATA.mkdir(exist_ok=True)
    atomic_json_write(DATA / 'agent_config.json', payload)
    write_registry_artifacts(result)
    log.info(f'{len(result)} agents synced')

    # 自动部署 SOUL.md 到 workspace（如果项目里有更新）
    deploy_soul_files(result)
    # 同步 scripts/ 到各 workspace（保持 kanban_update.py 等最新）
    sync_scripts_to_workspaces()


    # 项目 agents/ 目录名 → 运行时 agent_id 映射（保留旧目录名以兼容现有 OpenClaw 运行结构）
_SOUL_DEPLOY_MAP = {
    'taizi': 'taizi',
    'zhongshu': 'zhongshu',
    'menxia': 'menxia',
    'shangshu': 'shangshu',
    'libu': 'libu',
    'hubu': 'hubu',
    'bingbu': 'bingbu',
    'xingbu': 'xingbu',
    'gongbu': 'gongbu',
    'libu_hr': 'libu_hr',
    'zaochao': 'zaochao',
}

def _sync_script_symlink(src_file: pathlib.Path, dst_file: pathlib.Path) -> bool:
    """Create a symlink dst_file → src_file (resolved).

    Using symlinks instead of physical copies ensures that ``__file__`` in
    each script always resolves back to the project ``scripts/`` directory,
    so relative-path computations like ``Path(__file__).resolve().parent.parent``
    point to the correct project root regardless of which workspace runs the
    script.  (Fixes #56 — kanban data-path split)

    Returns True if the link was (re-)created, False if already up-to-date.
    """
    src_resolved = src_file.resolve()
    # Guard: skip if dst resolves to the same real path as src.
    # This happens when ws_scripts is itself a directory-level symlink pointing
    # to the project scripts/ dir (created by install.sh link_resources).
    # Without this check the function would unlink the real source file and
    # then create a self-referential symlink (foo.py -> foo.py).
    try:
        dst_resolved = dst_file.resolve()
    except OSError:
        dst_resolved = None
    if dst_resolved == src_resolved:
        return False
    # Already a correct symlink?
    if dst_file.is_symlink() and dst_resolved == src_resolved:
        return False
    # Remove stale file / old physical copy / broken symlink
    if dst_file.exists() or dst_file.is_symlink():
        dst_file.unlink()
    os.symlink(src_resolved, dst_file)
    return True


def sync_scripts_to_workspaces():
    """将项目 scripts/ 目录同步到各 agent workspace（保持 kanban_update.py 等最新）

    Uses symlinks so that ``__file__`` in workspace copies resolves to the
    project ``scripts/`` directory, keeping path-derived constants like
    ``TASKS_FILE`` pointing to the canonical ``data/`` folder.
    """
    scripts_src = BASE / 'scripts'
    if not scripts_src.is_dir():
        return
    synced = 0
    for proj_name, runtime_id in _SOUL_DEPLOY_MAP.items():
        ws_scripts = pathlib.Path.home() / f'.openclaw/workspace-{runtime_id}' / 'scripts'
        ws_scripts.mkdir(parents=True, exist_ok=True)
        for src_file in scripts_src.iterdir():
            if src_file.suffix not in ('.py', '.sh') or src_file.stem.startswith('__'):
                continue
            dst_file = ws_scripts / src_file.name
            try:
                if _sync_script_symlink(src_file, dst_file):
                    synced += 1
            except Exception:
                continue
    # also sync to workspace-main for legacy compatibility
    ws_main_scripts = pathlib.Path.home() / '.openclaw/workspace-main/scripts'
    ws_main_scripts.mkdir(parents=True, exist_ok=True)
    for src_file in scripts_src.iterdir():
        if src_file.suffix not in ('.py', '.sh') or src_file.stem.startswith('__'):
            continue
        dst_file = ws_main_scripts / src_file.name
        try:
            if _sync_script_symlink(src_file, dst_file):
                synced += 1
        except Exception:
            pass
    if synced:
        log.info(f'{synced} script symlinks synced to workspaces')


def deploy_soul_files(agents=None):
    """将项目 agents/xxx/SOUL.md 部署到 ~/.openclaw/workspace-xxx/soul.md，并写入 registry sidecar。 

    当前阶段保留旧目录与 agent_id，以兼容现有 OpenClaw 串行执行结构；
    用户可见名称与职责定义由现代中文元数据统一输出。若正式 SOUL 文件尚不存在，
    则回退使用 registry 自动生成的 SOUL 快照完成首次部署。
    """
    agents_dir = BASE / 'agents'
    deployed = 0
    agents = agents or []
    specs_by_id = {agent['id']: build_registry_spec(agent) for agent in agents}
    for proj_name, runtime_id in _SOUL_DEPLOY_MAP.items():
        src = agents_dir / proj_name / 'SOUL.md'
        generated_src = REGISTRY_GENERATED / f'{proj_name}.SOUL.md'
        if src.exists():
            src_text = src.read_text(encoding='utf-8', errors='ignore')
        elif generated_src.exists():
            src_text = generated_src.read_text(encoding='utf-8', errors='ignore')
        else:
            continue
        ws_dst = pathlib.Path.home() / f'.openclaw/workspace-{runtime_id}' / 'soul.md'
        ws_dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            dst_text = ws_dst.read_text(encoding='utf-8', errors='ignore')
        except FileNotFoundError:
            dst_text = ''
        if src_text != dst_text:
            ws_dst.write_text(src_text, encoding='utf-8')
            deployed += 1
        spec = specs_by_id.get(proj_name)
        if spec:
            sidecar = ws_dst.parent / '.registry.json'
            atomic_json_write(sidecar, spec)
        if runtime_id == 'taizi':
            ag_dst = pathlib.Path.home() / '.openclaw/agents/main/SOUL.md'
            ag_dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                ag_text = ag_dst.read_text(encoding='utf-8', errors='ignore')
            except FileNotFoundError:
                ag_text = ''
            if src_text != ag_text:
                ag_dst.write_text(src_text, encoding='utf-8')
        sess_dir = pathlib.Path.home() / f'.openclaw/agents/{runtime_id}/sessions'
        sess_dir.mkdir(parents=True, exist_ok=True)
    if deployed:
        log.info(f'{deployed} SOUL.md files deployed')


if __name__ == '__main__':
    main()
