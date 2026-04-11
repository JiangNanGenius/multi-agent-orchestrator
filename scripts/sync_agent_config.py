#!/usr/bin/env python3
"""
同步 openclaw.json 中的 agent 配置 → data/agent_config.json
支持自动发现 agent workspace 下的 Skills 目录
输出多Agent智作中枢所需的现代中文节点标签与职责元数据
"""
import json, os, pathlib, datetime, logging, sys

if __package__ in (None, ''):
    scripts_dir = pathlib.Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

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

DEFAULT_AGENT_META = {
    'control_center':    {'label': '总控中心', 'role': '总控中心', 'duty': '任务受理、首轮处理、快速分流与异常升级', 'emoji': '🎛️'},
    'plan_center':       {'label': '规划中心', 'role': '规划中心', 'duty': '任务拆解、方案生成与流程编排', 'emoji': '🧭'},
    'review_center':     {'label': '评审中心', 'role': '评审中心', 'duty': '质量核验、约束检查与回退把关', 'emoji': '🔍'},
    'dispatch_center':   {'label': '调度中心', 'role': '调度中心', 'duty': '任务派发、升级协调与状态汇总', 'emoji': '📮'},
    'docs_specialist':   {'label': '文案专家', 'role': '文案专家', 'duty': '文档撰写、汇报整理与表达优化', 'emoji': '📝'},
    'data_specialist':   {'label': '数据专家', 'role': '数据专家', 'duty': '数据分析、成本评估与资源测算', 'emoji': '💰'},
    'code_specialist':   {'label': '代码专家', 'role': '代码专家', 'duty': '工程实现、缺陷修复与架构设计', 'emoji': '⚔️'},
    'audit_specialist':  {'label': '审计专家', 'role': '审计专家', 'duty': '审核、审计追踪与风险控制', 'emoji': '⚖️'},
    'deploy_specialist': {'label': '部署专家', 'role': '部署专家', 'duty': '基础设施、部署运维与环境处理', 'emoji': '🔧'},
    'admin_specialist':  {'label': '管理专家', 'role': '管理专家', 'duty': 'Agent 注册、培训、管理与配置维护', 'emoji': '👔'},
    'expert_curator':    {'label': '专家编组官', 'role': '专家编组官', 'duty': '专家新增、非预置专家删除与专家名册治理', 'emoji': '🧩'},
    'search_specialist': {'label': '搜索专家', 'role': '搜索专家', 'duty': '全网检索、资料汇总、线索筛选与搜索结果整理', 'emoji': '📰'},
}

MODERN_AGENT_ID_ORDER = [
    'control_center',
    'plan_center',
    'review_center',
    'dispatch_center',
    'docs_specialist',
    'data_specialist',
    'code_specialist',
    'audit_specialist',
    'deploy_specialist',
    'admin_specialist',
    'expert_curator',
    'search_specialist',
]
MODERN_AGENT_ID_SET = set(MODERN_AGENT_ID_ORDER)


def is_specialist_agent(agent_id: str) -> bool:
    return agent_id.endswith('_specialist')


def is_center_agent(agent_id: str) -> bool:
    return agent_id.endswith('_center')


def _titleize_agent_token(text: str) -> str:
    parts = [part for part in text.replace('-', '_').split('_') if part]
    return ' '.join(part.capitalize() for part in parts) if parts else text

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
CONTROL_CENTER_IDS = {'control_center'}
DEFAULT_CENTER_AGENT_IDS = {'control_center', 'plan_center', 'review_center', 'dispatch_center'}
DEFAULT_SPECIALIST_AGENT_IDS = {'docs_specialist', 'data_specialist', 'code_specialist', 'audit_specialist', 'deploy_specialist', 'admin_specialist', 'expert_curator', 'search_specialist'}
CENTER_AGENT_IDS = set(DEFAULT_CENTER_AGENT_IDS)
SPECIALIST_AGENT_IDS = set(DEFAULT_SPECIALIST_AGENT_IDS)
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
    'python3 scripts/kanban_update.py create <id> "<标题>" <state> <org> <owner>',
    'python3 scripts/kanban_update.py state <id> <state> "<说明>"',
    'python3 scripts/kanban_update.py flow <id> "<from>" "<to>" "<remark>"',
    'python3 scripts/kanban_update.py done <id> "<output>" "<summary>"',
    'python3 scripts/kanban_update.py progress <id> "<当前在做什么>" "<计划1✅|计划2🔄|计划3>"',
    'python3 scripts/kanban_update.py todo <id> <todo_id> "<title>" <status> --detail "<产出详情>"',
]


def _has_required_soul_sections(text: str) -> bool:
    """检查 SOUL 文档是否包含标准化部署所需的必需章节。"""
    if not text:
        return False
    return all(section in text for section in SOUL_REQUIRED_SECTIONS)


def _build_effective_soul_text(agent_id: str, source_text: str, spec: dict | None = None) -> str:
    """生成可直接部署的 SOUL 文本。

    若仓库中的正式 SOUL 已包含标准章节，则原样保留；
    若仍是历史手写版本，则以前置标准骨架 + 原始细则附录的方式补齐，
    避免在不删减原始提示词细节的前提下因结构缺失影响直接部署。
    """
    source_text = source_text or ''
    if _has_required_soul_sections(source_text):
        return source_text
    spec = spec or {}
    generated_text = render_soul_from_registry(spec) if spec else ''
    if not generated_text:
        return source_text
    preserved = source_text.strip()
    if not preserved:
        return generated_text
    return (
        generated_text.rstrip()
        + '\n\n---\n\n'
        + '## 角色专用细则\n'
        + '以下内容保留该角色原始提示词中的专用流程、领域规则与执行细节；部署时必须与上面的标准章节共同生效，不得删减。\n\n'
        + preserved
        + '\n'
    )


def _write_soul_validation_report(agents: list):
    """输出 SOUL 完整性检查结果，便于部署前核对。"""
    report = {
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'requiredSections': SOUL_REQUIRED_SECTIONS,
        'agents': [],
    }
    agents_dir = BASE / 'agents'
    for agent in agents:
        source_path = agents_dir / agent['id'] / 'SOUL.md'
        source_text = source_path.read_text(encoding='utf-8', errors='ignore') if source_path.exists() else ''
        missing = [section for section in SOUL_REQUIRED_SECTIONS if section not in source_text]
        report['agents'].append({
            'agentId': agent['id'],
            'sourcePath': str(source_path),
            'hasRequiredSections': not missing,
            'missingSections': missing,
            'deployStrategy': 'source' if not missing else 'generated_scaffold_plus_source',
        })
    atomic_json_write(REGISTRY / 'soul_validation_report.json', report)


def classify_agent_group(agent_id: str) -> str:
    if agent_id in CONTROL_CENTER_IDS:
        return '总控中心'
    if agent_id in CENTER_AGENT_IDS or is_center_agent(agent_id):
        return '流程中心'
    if agent_id in SPECIALIST_AGENT_IDS or is_specialist_agent(agent_id):
        return '专家执行组'
    return '协作节点'


def infer_expert_category(agent_id: str, meta: dict) -> str:
    if agent_id in SPECIALIST_AGENT_IDS or is_specialist_agent(agent_id):
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
        'isExpert': agent_id in SPECIALIST_AGENT_IDS,
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
    is_specialist = agent_id in SPECIALIST_AGENT_IDS or is_specialist_agent(agent_id)
    positioning = meta['duty']
    if is_control_center:
        positioning = '系统统一入口，负责受理任务、首轮处理、快速分流与异常升级。'
    elif agent_id == 'plan_center':
        positioning = '负责拆解任务、制定方案并推动后续流程进入评审与执行。'
    elif agent_id == 'review_center':
        positioning = '负责质量核验、约束检查与回退把关。'
    elif agent_id == 'dispatch_center':
        positioning = '负责任务派发、升级协调、汇总执行状态与结果。'
    elif is_specialist:
        positioning = f'作为专家执行组下的{meta["label"]}，负责对应专业域的具体执行。'
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
    existing_spec = agent.get('existingSpec') or {}
    existing_deployment = existing_spec.get('deployment') or {}
    existing_visibility = existing_spec.get('visibility') or {}
    existing_metadata = existing_spec.get('metadata') or {}
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
            'heartbeatSeconds': runtime_policy.get('heartbeatSeconds', 5 if runtime_policy.get('realtimeTier') == 'highest' else 15),
            'staleAfterSeconds': runtime_policy.get('staleAfterSeconds', 20 if runtime_policy.get('realtimeTier') == 'highest' else 45),
            'queueStrategy': runtime_policy.get('queueStrategy', 'single-agent-single-task'),
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
            'projectSourcePath': existing_deployment.get('projectSourcePath') or f'agents/{agent["id"]}/SOUL.md',
            'workspaceTargetPath': existing_deployment.get('workspaceTargetPath') or str(pathlib.Path.home() / f'.openclaw/workspace-{agent["id"]}' / 'SOUL.md'),
            'legacyTargets': [],
            'deployOnSync': existing_deployment.get('deployOnSync', True),
            'writeSpecSidecar': existing_deployment.get('writeSpecSidecar', True),
            'writeGeneratedSoulSnapshot': existing_deployment.get('writeGeneratedSoulSnapshot', True),
            'syncScripts': existing_deployment.get('syncScripts', True),
        },
        'visibility': {
            'showInDashboard': existing_visibility.get('showInDashboard', True),
            'showInRegistry': existing_visibility.get('showInRegistry', True),
            'tags': existing_visibility.get('tags', [PRODUCT_NAME, group, agent['role']]),
        },
        'metadata': {
            **existing_metadata,
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
''' + system_repair_text + f'''

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
    valid_agent_ids = {agent['id'] for agent in agents}

    for stale_spec in REGISTRY_SPECS.glob('*.json'):
        if stale_spec.stem not in valid_agent_ids:
            stale_spec.unlink(missing_ok=True)
    for stale_generated in REGISTRY_GENERATED.glob('*.SOUL.md'):
        stale_agent_id = stale_generated.name[:-len('.SOUL.md')]
        if stale_agent_id not in valid_agent_ids:
            stale_generated.unlink(missing_ok=True)

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


def discover_project_agent_ids() -> list[str]:
    agents_dir = BASE / 'agents'
    if not agents_dir.is_dir():
        return []
    return sorted(
        item.name
        for item in agents_dir.iterdir()
        if item.is_dir() and (item / 'SOUL.md').exists()
    )


def load_existing_registry_spec(agent_id: str) -> dict:
    spec_path = REGISTRY_SPECS / f'{agent_id}.json'
    if not spec_path.exists():
        return {}
    try:
        return json.loads(spec_path.read_text(encoding='utf-8'))
    except Exception as e:
        log.warning(f'cannot read registry spec for {agent_id}: {e}')
        return {}


def infer_agent_meta(agent_id: str, existing_spec: dict | None = None) -> dict:
    if agent_id in DEFAULT_AGENT_META:
        return DEFAULT_AGENT_META[agent_id].copy()
    existing_spec = existing_spec or {}
    display = existing_spec.get('display') or {}
    label = display.get('label')
    role = display.get('roleName')
    duty = display.get('summary')
    emoji = display.get('icon') or '🤖'
    base_name = _titleize_agent_token(agent_id.removesuffix('_specialist').removesuffix('_center'))
    if not label:
        if is_specialist_agent(agent_id):
            label = f'{base_name}专家'
        elif is_center_agent(agent_id):
            label = f'{base_name}中心'
        else:
            label = _titleize_agent_token(agent_id)
    if not role:
        role = label
    if not duty:
        if is_specialist_agent(agent_id):
            duty = f'承担{base_name}相关执行、分析与交付工作'
        elif is_center_agent(agent_id):
            duty = f'承担{base_name}相关流程协调、分流与结果汇总'
        else:
            duty = f'承担{label}相关协作工作'
    return {'label': label, 'role': role, 'duty': duty, 'emoji': emoji}


def build_default_allow_agents(agent_id: str, candidate_ids: list[str]) -> list[str]:
    candidate_set = set(candidate_ids)
    specialists = [item for item in candidate_ids if is_specialist_agent(item)]
    if agent_id == 'control_center':
        return [item for item in ['plan_center'] if item in candidate_set]
    if agent_id == 'plan_center':
        return [item for item in ['review_center', 'dispatch_center'] if item in candidate_set]
    if agent_id == 'review_center':
        return [item for item in ['dispatch_center', 'plan_center'] if item in candidate_set]
    if agent_id == 'dispatch_center':
        seeds = ['plan_center', 'review_center', *specialists]
        return [item for item in seeds if item in candidate_set and item != agent_id]
    if is_specialist_agent(agent_id):
        return [item for item in ['dispatch_center'] if item in candidate_set]
    if is_center_agent(agent_id):
        return [item for item in ['dispatch_center'] if item in candidate_set and item != agent_id]
    return []


def merge_allow_agents(agent_id: str, explicit_allow_agents, candidate_ids: list[str]) -> list[str]:
    explicit_allow_agents = explicit_allow_agents or []
    default_allow_agents = build_default_allow_agents(agent_id, candidate_ids)
    merged = explicit_allow_agents[:]
    if agent_id in {'control_center', 'plan_center', 'review_center', 'dispatch_center'}:
        merged.extend(default_allow_agents)
    elif not merged:
        merged = default_allow_agents
    candidate_set = set(candidate_ids)
    ordered = []
    for item in merged:
        if item == agent_id or item not in candidate_set or item in ordered:
            continue
        ordered.append(item)
    return ordered


def merge_runtime_policy(agent_id: str, existing_spec: dict | None = None) -> dict:
    base_policy = build_runtime_policy(agent_id)
    spec_policy = (existing_spec or {}).get('runtimePolicy') or {}
    return {**base_policy, **spec_policy}


def merge_registry_meta(agent_id: str, meta: dict, existing_spec: dict | None = None) -> dict:
    existing_spec = existing_spec or {}
    base_meta = build_registry_meta(agent_id, meta)
    existing_visibility = existing_spec.get('visibility') or {}
    existing_metadata = existing_spec.get('metadata') or {}
    if existing_visibility.get('tags'):
        base_meta['tags'] = existing_visibility['tags']
    if existing_metadata.get('source'):
        base_meta['source'] = existing_metadata['source']
    return base_meta


def collect_candidate_agent_ids(agents_list: list[dict]) -> list[str]:
    runtime_ids = {
        str(item.get('id', '')).strip()
        for item in agents_list
        if isinstance(item, dict) and str(item.get('id', '')).strip()
    }
    unknown_runtime_ids = sorted(agent_id for agent_id in runtime_ids if agent_id not in MODERN_AGENT_ID_SET)
    if unknown_runtime_ids:
        log.warning('ignore legacy or unknown runtime agent ids: %s', ', '.join(unknown_runtime_ids))
    return MODERN_AGENT_ID_ORDER[:]


def resolve_runtime_workspace(agent_id: str, runtime_agent: dict, existing_spec: dict | None = None) -> str:
    existing_spec = existing_spec or {}
    workspace_value = runtime_agent.get('workspace') or (existing_spec.get('metadata') or {}).get('workspace') or ''
    return normalize_workspace_path(agent_id, workspace_value)


def extract_runtime_allow_agents(runtime_agent: dict, existing_spec: dict | None = None) -> list[str]:
    if 'allowAgents' in runtime_agent:
        return runtime_agent.get('allowAgents', []) or []
    if runtime_agent.get('subagents'):
        return runtime_agent.get('subagents', {}).get('allowAgents', []) or []
    existing_spec = existing_spec or {}
    return (existing_spec.get('routing') or {}).get('allowedTargets', []) or []


def build_agent_entry(agent_id: str, runtime_agent: dict, default_model: str, candidate_ids: list[str]) -> dict:
    existing_spec = load_existing_registry_spec(agent_id)
    meta = infer_agent_meta(agent_id, existing_spec)
    workspace = resolve_runtime_workspace(agent_id, runtime_agent, existing_spec)
    allow_agents = merge_allow_agents(agent_id, extract_runtime_allow_agents(runtime_agent, existing_spec), candidate_ids)
    runtime_policy = merge_runtime_policy(agent_id, existing_spec)
    if is_center_agent(agent_id):
        CENTER_AGENT_IDS.add(agent_id)
    if is_specialist_agent(agent_id):
        SPECIALIST_AGENT_IDS.add(agent_id)
    return {
        'id': agent_id,
        'label': meta['label'],
        'role': meta['role'],
        'duty': meta['duty'],
        'emoji': meta['emoji'],
        'model': normalize_model(runtime_agent.get('model', default_model), default_model),
        'defaultModel': default_model,
        'workspace': workspace,
        'skills': get_skills(workspace),
        'allowAgents': allow_agents,
        'registry': merge_registry_meta(agent_id, meta, existing_spec),
        'runtimePolicy': runtime_policy,
        'existingSpec': existing_spec,
        'isDiscoveredFromProject': agent_id in discover_project_agent_ids(),
    }


def get_sync_target_ids(agents=None) -> list[str]:
    return MODERN_AGENT_ID_ORDER[:]


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
    candidate_ids = collect_candidate_agent_ids(agents_list)
    runtime_agents_by_id = {item.get('id', ''): item for item in agents_list if item.get('id')}

    result = [
        build_agent_entry(agent_id, runtime_agents_by_id.get(agent_id, {}), default_model, candidate_ids)
        for agent_id in candidate_ids
    ]

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
    _write_soul_validation_report(result)
    log.info(f'{len(result)} agents synced')

    # 自动部署 SOUL.md 到 workspace（如果项目里有更新）
    deploy_soul_files(result)
    # 同步 scripts/ 到各 workspace（保持 kanban_update.py 等最新）
    sync_scripts_to_workspaces(result)


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


def sync_scripts_to_workspaces(agents=None):
    """将项目 scripts/ 目录同步到各 agent workspace（保持 kanban_update.py 等最新）

    Uses symlinks so that ``__file__`` in workspace copies resolves to the
    project ``scripts/`` directory, keeping path-derived constants like
    ``TASKS_FILE`` pointing to the canonical ``data/`` folder.
    """
    scripts_src = BASE / 'scripts'
    if not scripts_src.is_dir():
        return
    synced = 0
    for runtime_id in get_sync_target_ids(agents):
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

    if synced:
        log.info(f'{synced} script symlinks synced to workspaces')


def deploy_soul_files(agents=None):
    """将项目 agents/xxx/SOUL.md 部署到 ~/.openclaw/workspace-xxx/SOUL.md，并写入 registry sidecar。 

    当前阶段采用无兼容的一一对应目录与 agent_id；
    用户可见名称与职责定义由现代中文元数据统一输出。若正式 SOUL 文件尚不存在，
    则回退使用 registry 自动生成的 SOUL 快照完成首次部署。
    """
    agents_dir = BASE / 'agents'
    deployed = 0
    agents = agents or []
    specs_by_id = {agent['id']: build_registry_spec(agent) for agent in agents}
    for runtime_id in get_sync_target_ids(agents):
        src = agents_dir / runtime_id / 'SOUL.md'
        generated_src = REGISTRY_GENERATED / f'{runtime_id}.SOUL.md'
        spec = specs_by_id.get(runtime_id)
        if src.exists():
            raw_src_text = src.read_text(encoding='utf-8', errors='ignore')
            src_text = _build_effective_soul_text(runtime_id, raw_src_text, spec)
        elif generated_src.exists():
            src_text = generated_src.read_text(encoding='utf-8', errors='ignore')
        else:
            continue
        ws_dst = pathlib.Path.home() / f'.openclaw/workspace-{runtime_id}' / 'SOUL.md'
        ws_dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            dst_text = ws_dst.read_text(encoding='utf-8', errors='ignore')
        except FileNotFoundError:
            dst_text = ''
        if src_text != dst_text:
            ws_dst.write_text(src_text, encoding='utf-8')
            deployed += 1
        if spec:
            sidecar = ws_dst.parent / '.registry.json'
            atomic_json_write(sidecar, spec)

        sess_dir = pathlib.Path.home() / f'.openclaw/agents/{runtime_id}/sessions'
        sess_dir.mkdir(parents=True, exist_ok=True)
    if deployed:
        log.info(f'{deployed} SOUL.md files deployed')


if __name__ == '__main__':
    main()
