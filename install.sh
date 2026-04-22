#!/bin/bash
# ══════════════════════════════════════════════════════════════
# AGENTORCHESTRATOR · OpenClaw 安装脚本
# ══════════════════════════════════════════════════════════════
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OC_HOME="$HOME/.openclaw"
OC_CFG="$OC_HOME/openclaw.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

banner() {
  echo ""
  echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  AGENTORCHESTRATOR · OpenClaw 本地对接辅助            ║${NC}"
  echo -e "${BLUE}║  AI 部署优先，脚本仅用于本地补齐          ║${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

log()   { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; }
info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }

load_agents_from_specs() {
  mapfile -t AGENTS < <(REPO_DIR="$REPO_DIR" python3 << 'PYEOF'
import json, os, pathlib
repo = pathlib.Path(os.environ["REPO_DIR"])
specs = repo / "registry" / "specs"
agents_dir = repo / "agents"
ids = []
for path in sorted(specs.glob("*.json")):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        continue
    aid = data.get("agentId") or path.stem
    if aid and aid not in ids:
        ids.append(aid)
if not ids and agents_dir.is_dir():
    for entry in sorted(agents_dir.iterdir()):
        if entry.is_dir() and (entry / "SOUL.md").exists():
            ids.append(entry.name)
print("\\n".join(ids))
PYEOF
  )
  if [ ${#AGENTS[@]} -eq 0 ]; then
    warn "未从 registry/specs 或 agents/ 发现角色，回退到内置最小角色集。"
    AGENTS=(control_center plan_center review_center dispatch_center data_specialist docs_specialist code_specialist audit_specialist deploy_specialist admin_specialist expert_curator search_specialist)
  fi
}

# ── Step 0: 依赖检查 ──────────────────────────────────────────
check_deps() {
  info "检查依赖..."
  
  if ! command -v openclaw &>/dev/null; then
    error "未找到 openclaw CLI。请先安装 OpenClaw: https://openclaw.ai"
    exit 1
  fi
  log "OpenClaw CLI: $(openclaw --version 2>/dev/null || echo 'OK')"

  if ! command -v python3 &>/dev/null; then
    error "未找到 python3"
    exit 1
  fi
  log "Python3: $(python3 --version)"

  if [ ! -f "$OC_CFG" ]; then
    error "未找到 openclaw.json。请先运行 openclaw 完成初始化。"
    exit 1
  fi
  log "openclaw.json: $OC_CFG"
}

ensure_backend_deps() {
  info "检查官方后端 Python 依赖..."

  local req_file="$REPO_DIR/agentorchestrator/backend/requirements.txt"
  if [ ! -f "$req_file" ]; then
    warn "未找到后端依赖清单：$req_file，跳过自动安装。"
    return
  fi

  if ! python3 - <<'PYEOF' >/dev/null 2>&1
import importlib.util
modules = [
    'fastapi',
    'uvicorn',
    'sqlalchemy',
    'asyncpg',
    'aiosqlite',
    'alembic',
    'pydantic',
    'pydantic_settings',
    'dotenv',
    'httpx',
]
missing = [name for name in modules if importlib.util.find_spec(name) is None]
raise SystemExit(0 if not missing else 1)
PYEOF
  then
    warn "检测到官方后端依赖缺失，开始自动安装 requirements.txt ..."
    if ! python3 -m pip --version >/dev/null 2>&1; then
      error "当前 Python 未提供 pip，请先安装 pip 后重试。"
      exit 1
    fi
    python3 -m pip install --user --disable-pip-version-check -r "$req_file"
  fi

  if ! python3 - <<'PYEOF' >/dev/null 2>&1
import importlib.util
modules = [
    'fastapi',
    'uvicorn',
    'sqlalchemy',
    'asyncpg',
    'aiosqlite',
    'alembic',
    'pydantic',
    'pydantic_settings',
    'dotenv',
    'httpx',
]
missing = [name for name in modules if importlib.util.find_spec(name) is None]
raise SystemExit(0 if not missing else 1)
PYEOF
  then
    error "官方后端依赖仍不完整，请手动执行：python3 -m pip install --user -r agentorchestrator/backend/requirements.txt"
    exit 1
  fi

  log "官方后端依赖已就绪"
}

# ── Step 0.5: 备份已有 Agent 数据 ──────────────────────────────
backup_existing() {
  AGENTS_DIR="$OC_HOME"
  BACKUP_DIR="$OC_HOME/backups/pre-install-$(date +%Y%m%d-%H%M%S)"
  HAS_EXISTING=false

  # 检查是否有已存在的 workspace
  for d in "$AGENTS_DIR"/workspace-*/; do
    if [ -d "$d" ]; then
      HAS_EXISTING=true
      break
    fi
  done

  if $HAS_EXISTING; then
    info "检测到已有 Agent Workspace，自动备份中..."
    mkdir -p "$BACKUP_DIR"

    # 备份所有 workspace 目录
    for d in "$AGENTS_DIR"/workspace-*/; do
      if [ -d "$d" ]; then
        ws_name=$(basename "$d")
        cp -R "$d" "$BACKUP_DIR/$ws_name"
      fi
    done

    # 备份 openclaw.json
    if [ -f "$OC_CFG" ]; then
      cp "$OC_CFG" "$BACKUP_DIR/openclaw.json"
    fi

    # 备份 agents 目录（agent 注册信息）
    if [ -d "$AGENTS_DIR/agents" ]; then
      cp -R "$AGENTS_DIR/agents" "$BACKUP_DIR/agents"
    fi

    log "已备份到: $BACKUP_DIR"
    info "如需恢复，运行: cp -R $BACKUP_DIR/workspace-* $AGENTS_DIR/"
  fi
}

# ── Step 1: 创建 Workspace ──────────────────────────────────
create_workspaces() {
  info "创建 Agent Workspace..."
  load_agents_from_specs
  for agent in "${AGENTS[@]}"; do
    ws="$OC_HOME/workspace-$agent"
    mkdir -p "$ws/skills"
    if [ -f "$REPO_DIR/agents/$agent/SOUL.md" ]; then
      if [ -f "$ws/SOUL.md" ]; then
        # 已存在的 SOUL.md，先备份再覆盖
        cp "$ws/SOUL.md" "$ws/SOUL.md.bak.$(date +%Y%m%d-%H%M%S)"
        warn "已备份旧 SOUL.md → $ws/SOUL.md.bak.*"
      fi
      sed "s|__REPO_DIR__|$REPO_DIR|g" "$REPO_DIR/agents/$agent/SOUL.md" > "$ws/SOUL.md"
    fi
    log "Workspace 已创建: $ws"
  done

  # 通用 AGENTS.md（工作协议）
  for agent in "${AGENTS[@]}"; do
    cat > "$OC_HOME/workspace-$agent/AGENTS.md" << 'AGENTS_EOF'
# AGENTS.md · 工作协议

1. 接到任务先回复“已接收任务”。
2. 输出必须包含：任务 ID、结果、证据或文件路径、阻塞项。
3. 需要协作时，通过统一调度方请求转派，不直接跨角色并行写入。
4. 涉及删除、外发或高风险动作时，必须明确标注并等待批准。
AGENTS_EOF
  done
}

# ── Step 2: 自动补齐运行时 Agent 注册并校验 ─────────────────────
register_agents() {
  info "检查并补齐 OpenClaw 运行时 Agent 注册..."

  local cfg_path="$HOME/.openclaw/openclaw.json"
  if [ ! -f "$cfg_path" ]; then
    warn "未找到 $cfg_path，跳过运行时 Agent 注册。"
    warn "请先完成 OpenClaw 初始化后重新运行 install.sh。"
    return
  fi

  REPO_DIR="$REPO_DIR" python3 << 'PYEOF'
import json, pathlib, os, sys
from datetime import datetime

cfg_path = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
try:
    cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
except Exception as exc:
    print(f'ERROR: 无法读取 openclaw.json: {exc}')
    sys.exit(2)

repo = pathlib.Path(os.environ['REPO_DIR'])
specs_dir = repo / 'registry' / 'specs'
spec_ids = []
icon_map = {}
for path in sorted(specs_dir.glob('*.json')):
    try:
        spec = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        continue
    aid = spec.get('agentId') or path.stem
    if aid and aid not in spec_ids:
        spec_ids.append(aid)
    if aid:
        icon = ((spec.get('display') or {}).get('icon') or '').strip()
        if icon:
            icon_map[aid] = icon
if not spec_ids:
    agents_dir = repo / 'agents'
    for item in sorted(agents_dir.iterdir()):
        if item.is_dir() and (item / 'SOUL.md').exists():
            spec_ids.append(item.name)

specialists = [item for item in spec_ids if item.endswith('_specialist')]
required = []
for agent_id in spec_ids:
    if agent_id == 'control_center':
        allow_agents = [x for x in ['plan_center'] if x in spec_ids]
    elif agent_id == 'plan_center':
        allow_agents = [x for x in ['review_center', 'dispatch_center'] if x in spec_ids]
    elif agent_id == 'review_center':
        allow_agents = [x for x in ['dispatch_center', 'plan_center'] if x in spec_ids]
    elif agent_id == 'dispatch_center':
        allow_agents = [x for x in ['plan_center', 'review_center', *specialists] if x in spec_ids and x != agent_id]
    elif agent_id.endswith('_specialist'):
        allow_agents = [x for x in ['dispatch_center'] if x in spec_ids]
    elif agent_id.endswith('_center'):
        allow_agents = [x for x in ['dispatch_center'] if x in spec_ids and x != agent_id]
    else:
        allow_agents = []

    required.append({
        "id": agent_id,
        "workspace": str(pathlib.Path.home() / f'.openclaw/workspace-{agent_id}'),
        "identity": {"emoji": icon_map.get(agent_id, "🤖")},
        "subagents": {"allowAgents": allow_agents},
    })

agents_cfg = cfg.setdefault('agents', {})
agent_list = agents_cfg.setdefault('list', [])
existing_by_id = {item.get('id'): item for item in agent_list if item.get('id')}
added, updated, missing = [], [], []

for spec in required:
    current = existing_by_id.get(spec['id'])
    if current is None:
        agent_list.append(spec)
        added.append(spec['id'])
        continue
    changed = False
    if current.get('workspace') != spec['workspace']:
        current['workspace'] = spec['workspace']
        changed = True
    subagents = current.setdefault('subagents', {})
    allow_agents = subagents.setdefault('allowAgents', [])
    desired = spec['subagents']['allowAgents']
    if allow_agents != desired:
        subagents['allowAgents'] = desired
        changed = True
    identity = current.setdefault('identity', {})
    desired_emoji = ((spec.get('identity') or {}).get('emoji') or '').strip()
    if desired_emoji and identity.get('emoji') != desired_emoji:
        identity['emoji'] = desired_emoji
        changed = True
    if changed:
        updated.append(spec['id'])

cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

final_ids = {item.get('id') for item in cfg.get('agents', {}).get('list', []) if item.get('id')}
for spec in required:
    if spec['id'] not in final_ids:
        missing.append(spec)

report = {
    'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'mode': 'auto_register_and_verify',
    'message': 'install.sh 已尝试自动补齐 openclaw.json 中缺失或漂移的 agent 注册项，并要求后续 gateway 校验通过。',
    'addedAgents': added,
    'updatedAgents': updated,
    'missingAgents': missing,
}
report_path = pathlib.Path(os.environ['REPO_DIR']) / 'data' / 'openclaw_registry_suggestions.json'
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print(f'已注册 Agent: {len(final_ids)}')
if added:
    print('新增注册项: ' + ', '.join(added))
if updated:
    print('修正注册项: ' + ', '.join(updated))
if missing:
    print('ERROR: 仍有缺失的 Agent 注册项:')
    for item in missing:
        print(f"  - {item['id']} -> {item['workspace']}")
    sys.exit(3)
print(f'注册结果报告已写入: {report_path}')
PYEOF

  if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}❌ OpenClaw 运行时 Agent 注册校验失败，请检查 $REPO_DIR/data/openclaw_registry_suggestions.json${NC}"
    exit 1
  fi

  log "运行时 Agent 注册已补齐并通过本地校验"
}

# ── Step 3: 初始化 Data ─────────────────────────────────────
init_data() {
  info "初始化数据目录..."
  
  mkdir -p "$REPO_DIR/data"
  
  # 初始化空文件
  for f in live_status.json agent_config.json model_change_log.json; do
    if [ ! -f "$REPO_DIR/data/$f" ]; then
      echo '{}' > "$REPO_DIR/data/$f"
    fi
  done
  echo '[]' > "$REPO_DIR/data/pending_model_changes.json"

  # 初始任务文件
  if [ ! -f "$REPO_DIR/data/tasks_source.json" ]; then
    python3 << 'PYEOF'
import json, pathlib
tasks = [
    {
        "id": "JJC-DEMO-001",
        "title": "🎉 系统初始化完成",
        "owner": "系统看板",
        "org": "AGENTORCHESTRATOR",
        "state": "Done",
        "now": "AGENTORCHESTRATOR 系统已就绪",
        "eta": "-",
        "block": "无",
        "output": "",
        "ac": "系统正常运行",
        "flow_log": [
            {"at": "2024-01-01T00:00:00Z", "from": "system", "to": "control_center", "remark": "初始化 AGENTORCHESTRATOR 系统"},
            {"at": "2024-01-01T00:01:00Z", "from": "control_center", "to": "plan_center", "remark": "提交初始化方案规划"},
            {"at": "2024-01-01T00:02:00Z", "from": "plan_center", "to": "review_center", "remark": "提交初始化方案审核"},
            {"at": "2024-01-01T00:03:00Z", "from": "review_center", "to": "dispatch_center", "remark": "✅ 审核通过并进入派发"},
            {"at": "2024-01-01T00:04:00Z", "from": "dispatch_center", "to": "code_specialist", "remark": "✅ 完成系统初始化"},
        ]
    }
]
import os
data_dir = pathlib.Path(os.environ.get('REPO_DIR', '.')) / 'data'
data_dir.mkdir(exist_ok=True)
(data_dir / 'tasks_source.json').write_text(json.dumps(tasks, ensure_ascii=False, indent=2))
print('tasks_source.json 已初始化')
PYEOF
  fi

  log "数据目录初始化完成: $REPO_DIR/data"
}

# ── Step 3.3: 创建 data 软链接确保数据一致 (Fix #88) ─────────
link_resources() {
  info "创建 data/scripts 软链接以确保 Agent 数据一致..."
  load_agents_from_specs
  LINKED=0
  for agent in "${AGENTS[@]}"; do
    ws="$OC_HOME/workspace-$agent"
    mkdir -p "$ws"

    # 软链接 data 目录：确保各 agent 读写同一份 tasks_source.json
    ws_data="$ws/data"
    if [ -L "$ws_data" ]; then
      : # 已是软链接，跳过
    elif [ -d "$ws_data" ]; then
      # 已有 data 目录（非符号链接），备份后替换
      mv "$ws_data" "${ws_data}.bak.$(date +%Y%m%d-%H%M%S)"
      ln -s "$REPO_DIR/data" "$ws_data"
      LINKED=$((LINKED + 1))
    else
      ln -s "$REPO_DIR/data" "$ws_data"
      LINKED=$((LINKED + 1))
    fi

    # 软链接 scripts 目录
    ws_scripts="$ws/scripts"
    if [ -L "$ws_scripts" ]; then
      : # 已是软链接
    elif [ -d "$ws_scripts" ]; then
      mv "$ws_scripts" "${ws_scripts}.bak.$(date +%Y%m%d-%H%M%S)"
      ln -s "$REPO_DIR/scripts" "$ws_scripts"
      LINKED=$((LINKED + 1))
    else
      ln -s "$REPO_DIR/scripts" "$ws_scripts"
      LINKED=$((LINKED + 1))
    fi
  done

  log "已创建 $LINKED 个软链接（data/scripts → 项目目录）"
}

# ── Step 3.5: 设置 Agent 间通信可见性 (Fix #83) ──────────────
setup_visibility() {
  info "配置 Agent 间消息可见性..."
  if openclaw config set tools.sessions.visibility all 2>/dev/null; then
    log "已设置 tools.sessions.visibility=all（Agent 间可互相通信）"
  else
    warn "设置 visibility 失败（可能 openclaw 版本不支持），请手动执行:"
    echo "    openclaw config set tools.sessions.visibility all"
  fi
}

# ── Step 3.5b: 同步 API Key 到所有 Agent ──────────────────────────
sync_auth() {
  info "同步 API Key 到所有 Agent..."

  # OpenClaw ≥ 3.13 stores credentials in models.json; older versions use
  # auth-profiles.json. Try the new name first, then fall back to the old one.
  MAIN_AUTH=""
  AUTH_FILENAME=""
  AGENT_BASE="$OC_HOME/agents/control_center/agent"

  for candidate in models.json auth-profiles.json; do
    if [ -f "$AGENT_BASE/$candidate" ]; then
      MAIN_AUTH="$AGENT_BASE/$candidate"
      AUTH_FILENAME="$candidate"
      break
    fi
  done

  # Fallback: search across all agents for either filename
  if [ -z "$MAIN_AUTH" ]; then
    for candidate in models.json auth-profiles.json; do
      MAIN_AUTH=$(find "$OC_HOME/agents" -name "$candidate" -maxdepth 3 2>/dev/null | head -1)
      if [ -n "$MAIN_AUTH" ] && [ -f "$MAIN_AUTH" ]; then
        AUTH_FILENAME="$candidate"
        break
      fi
      MAIN_AUTH=""
    done
  fi

  if [ -z "$MAIN_AUTH" ] || [ ! -f "$MAIN_AUTH" ]; then
    warn "未找到已有的 models.json 或 auth-profiles.json"
    warn "请先为任意 Agent 配置 API Key:"
    echo "    openclaw agents add control_center"
    echo "  然后重新运行 install.sh，或手动执行:"
    echo "    bash install.sh --sync-auth"
    return
  fi

  # 检查文件内容是否有效（非空 JSON）
  if ! python3 -c "import json; d=json.load(open('$MAIN_AUTH')); assert d" 2>/dev/null; then
    warn "$AUTH_FILENAME 为空或无效，请先配置 API Key:"
    echo "    openclaw agents add control_center"
    return
  fi

  load_agents_from_specs
  SYNCED=0
  for agent in "${AGENTS[@]}"; do
    AGENT_DIR="$OC_HOME/agents/$agent/agent"
    if [ -d "$AGENT_DIR" ] || mkdir -p "$AGENT_DIR" 2>/dev/null; then
      cp "$MAIN_AUTH" "$AGENT_DIR/$AUTH_FILENAME"
      SYNCED=$((SYNCED + 1))
    fi
  done

  log "API Key 已同步到 $SYNCED 个 Agent"
  info "来源: $MAIN_AUTH"
}

# ── Step 4: 构建前端 ──────────────────────────────────────────
build_frontend() {
  info "构建 React 前端..."

  if ! command -v node &>/dev/null; then
    warn "未找到 node，跳过前端构建。看板将使用预构建版本（如果存在）"
    warn "请安装 Node.js 18+ 后运行: cd agentorchestrator/frontend && npm install && npm run build"
    return
  fi

  if [ -f "$REPO_DIR/agentorchestrator/frontend/package.json" ]; then
    cd "$REPO_DIR/agentorchestrator/frontend"
    if command -v pnpm &>/dev/null && [ -f "pnpm-lock.yaml" ]; then
      pnpm install --silent || pnpm install
      pnpm build
    else
      npm install --silent 2>/dev/null || npm install
      npm run build
    fi

    if [ -d "$REPO_DIR/agentorchestrator/frontend/dist" ]; then
      log "前端构建完成: agentorchestrator/frontend/dist/"
    else
      warn "前端构建失败：未找到可部署的 dist 产物，请手动检查"
    fi
    cd "$REPO_DIR"
  else
    warn "未找到 agentorchestrator/frontend/package.json，跳过前端构建"
  fi
}

# ── Step 5: 首次数据同步 ────────────────────────────────────
first_sync() {
  info "执行首次数据同步..."
  cd "$REPO_DIR"
  
  REPO_DIR="$REPO_DIR" python3 scripts/sync_agent_config.py || warn "sync_agent_config 有警告"
  python3 scripts/sync_agents_overview.py || warn "sync_agents_overview 有警告"
  python3 scripts/refresh_live_data.py || warn "refresh_live_data 有警告"
  
  log "首次同步完成"
}

# ── Step 6: 重启 Gateway ────────────────────────────────────
restart_gateway() {
  info "重启 OpenClaw Gateway..."
  if openclaw gateway restart 2>/dev/null; then
    log "Gateway 重启成功"
  else
    warn "Gateway 重启失败，请手动重启：openclaw gateway restart"
  fi
}

# ── Main ────────────────────────────────────────────────────
banner
check_deps
ensure_backend_deps
backup_existing
create_workspaces
register_agents
init_data
link_resources
setup_visibility
sync_auth
build_frontend
first_sync
restart_gateway

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  多Agent智作中枢安装完成                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "下一步："
echo "  1. 推荐方案：优先使用 AI 部署完成环境接入与编排。"
echo "  2. 如需本地补齐 API Key（可选）:"
echo "     openclaw agents add control_center     # 按提示输入模型密钥"
echo "     ./install.sh                           # 重新运行以同步到所有 Agent"
echo "  3. 官方本地启动入口:          ./agentorchestrator.sh start"
echo "     - 状态查看:                ./agentorchestrator.sh status"
echo "     - 日志查看:                ./agentorchestrator.sh logs all"
echo "     - API 地址:                http://127.0.0.1:8000"
echo "     - 说明:                    默认仅保留官方后端栈与正式前端开发入口"
echo "  4. 前端开发模式（可选）:       cd agentorchestrator/frontend && pnpm dev"
echo "     - 浏览器访问:              http://127.0.0.1:35173  (默认代理到 8000)"
echo ""
warn "若采用本地脚本模式，首次运行前仍需先配置可用模型密钥"
info "安装流程已尝试自动补齐 openclaw.json 中所需的运行时 Agent 注册，并在继续前完成本地校验；详情记录见 data/openclaw_registry_suggestions.json"
info "文档口径已调整为优先推荐 AI 部署；仓库仅保留正式版入口 ./agentorchestrator.sh start，详情见 docs/getting-started.md"
