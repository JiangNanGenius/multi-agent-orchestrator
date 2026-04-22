#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Multi-Agent Orchestrator · 统一服务管理脚本
# 用法: ./agentorchestrator.sh {start|stop|status|restart|logs}
# 默认启动：Backend API + Orchestrator Worker + Dispatch Worker + Outbox Relay
# ══════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDDIR="$REPO_DIR/.pids"
LOGDIR="$REPO_DIR/logs"

API_PIDFILE="$PIDDIR/api.pid"
ORCH_PIDFILE="$PIDDIR/orchestrator.pid"
DISPATCH_PIDFILE="$PIDDIR/dispatch.pid"
OUTBOX_PIDFILE="$PIDDIR/outbox.pid"

API_LOG="$LOGDIR/api.log"
ORCH_LOG="$LOGDIR/orchestrator.log"
DISPATCH_LOG="$LOGDIR/dispatch.log"
OUTBOX_LOG="$LOGDIR/outbox.log"

# 可通过环境变量覆盖的配置
API_HOST="${AGENTORCHESTRATOR_API_HOST:-127.0.0.1}"
API_PORT="${AGENTORCHESTRATOR_API_PORT:-8000}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

_ensure_dirs() {
  mkdir -p "$PIDDIR" "$LOGDIR" "$REPO_DIR/data"
  for f in live_status.json agent_config.json model_change_log.json sync_status.json; do
    if [[ ! -f "$REPO_DIR/data/$f" ]]; then
      echo '{}' > "$REPO_DIR/data/$f"
    fi
  done
  if [[ ! -f "$REPO_DIR/data/pending_model_changes.json" ]]; then
    echo '[]' > "$REPO_DIR/data/pending_model_changes.json"
  fi
  if [[ ! -f "$REPO_DIR/data/tasks_source.json" ]]; then
    echo '[]' > "$REPO_DIR/data/tasks_source.json"
  fi
  if [[ ! -f "$REPO_DIR/data/tasks.json" ]]; then
    echo '[]' > "$REPO_DIR/data/tasks.json"
  fi
  if [[ ! -f "$REPO_DIR/data/agents.json" ]]; then
    echo '[]' > "$REPO_DIR/data/agents.json"
  fi
  if [[ ! -f "$REPO_DIR/data/agents_overview.json" ]]; then
    echo '{}' > "$REPO_DIR/data/agents_overview.json"
  fi
}

_is_running() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pidfile"
  fi
  return 1
}

_get_pid() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    cat "$pidfile" 2>/dev/null
  fi
}

_check_backend_python_deps() {
  local req_file="$REPO_DIR/agentorchestrator/backend/requirements.txt"
  python3 - <<'PYEOF' >/tmp/agentorchestrator_backend_dep_check.txt 2>&1
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
if missing:
    print(', '.join(missing))
    raise SystemExit(1)
PYEOF
  local status=$?
  if [[ $status -ne 0 ]]; then
    local missing
    missing=$(cat /tmp/agentorchestrator_backend_dep_check.txt 2>/dev/null || true)
    echo -e "${RED}❌ 官方后端依赖不完整${NC}"
    if [[ -n "$missing" ]]; then
      echo -e "   缺失模块: ${YELLOW}$missing${NC}"
    fi
    echo -e "   请先执行: ${BLUE}python3 -m pip install --user -r $req_file${NC}"
    return 1
  fi
  return 0
}

_start_proc() {
  local label="$1"
  local pidfile="$2"
  local logfile="$3"
  shift 3

  if _is_running "$pidfile"; then
    echo -e "${YELLOW}⚠️  ${label} 已在运行 (PID=$(_get_pid "$pidfile"))${NC}"
    return 0
  fi

  echo -e "${GREEN}▶ 启动${label}...${NC}"
  (
    cd "$REPO_DIR"
    export PYTHONPATH="$REPO_DIR:${PYTHONPATH:-}"
    nohup "$@" >> "$logfile" 2>&1 &
    echo $! > "$pidfile"
  )
  sleep 1

  if _is_running "$pidfile"; then
    echo -e "  PID=$(_get_pid "$pidfile")  日志: ${BLUE}$logfile${NC}"
  else
    echo -e "${RED}❌ ${label} 启动失败，请查看日志: $logfile${NC}"
    return 1
  fi
}

_stop_proc() {
  local label="$1"
  local pidfile="$2"
  if _is_running "$pidfile"; then
    local pid
    pid=$(_get_pid "$pidfile")
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
    echo -e "  ✅ ${label} (PID=$pid) 已停止"
    return 0
  fi
  return 1
}

do_start() {
  _ensure_dirs

  if ! command -v python3 &>/dev/null; then
    echo -e "${RED}❌ 未找到 python3，请先安装 Python 3.11+${NC}"
    exit 1
  fi

  echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║  Multi-Agent Orchestrator 后端栈启动中            ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
  echo ""

  if ! _check_backend_python_deps; then
    exit 1
  fi

  _start_proc "Backend API" "$API_PIDFILE" "$API_LOG" python3 -m uvicorn agentorchestrator.backend.app.main:app --host "$API_HOST" --port "$API_PORT"
  _start_proc "Orchestrator Worker" "$ORCH_PIDFILE" "$ORCH_LOG" python3 -m agentorchestrator.backend.app.workers.orchestrator_worker
  _start_proc "Dispatch Worker" "$DISPATCH_PIDFILE" "$DISPATCH_LOG" python3 -m agentorchestrator.backend.app.workers.dispatch_worker
  _start_proc "Outbox Relay" "$OUTBOX_PIDFILE" "$OUTBOX_LOG" python3 -m agentorchestrator.backend.app.workers.outbox_relay

  echo ""
  if _is_running "$API_PIDFILE"; then
    echo -e "${GREEN}✅ 后端栈已启动${NC}"
    echo -e "   API 地址: ${BLUE}http://${API_HOST}:${API_PORT}${NC}"
    echo -e "   健康检查: ${BLUE}http://${API_HOST}:${API_PORT}/health${NC}"
  else
    echo -e "${RED}❌ Backend API 未成功启动，请查看日志: $API_LOG${NC}"
    exit 1
  fi
}

do_stop() {
  echo -e "${YELLOW}正在关闭服务...${NC}"
  local stopped=0

  for item in \
    "Outbox Relay:$OUTBOX_PIDFILE" \
    "Dispatch Worker:$DISPATCH_PIDFILE" \
    "Orchestrator Worker:$ORCH_PIDFILE" \
    "Backend API:$API_PIDFILE"; do
    local label="${item%%:*}"
    local pidfile="${item#*:}"
    if _stop_proc "$label" "$pidfile"; then
      stopped=$((stopped+1))
    fi
  done

  if [[ $stopped -eq 0 ]]; then
    echo -e "${YELLOW}  没有正在运行的服务${NC}"
  else
    echo -e "${GREEN}✅ 所有服务已关闭${NC}"
  fi
}

do_status() {
  echo -e "${BLUE}Multi-Agent Orchestrator · 服务状态${NC}"
  echo ""

  for item in \
    "Backend API:$API_PIDFILE" \
    "Orchestrator Worker:$ORCH_PIDFILE" \
    "Dispatch Worker:$DISPATCH_PIDFILE" \
    "Outbox Relay:$OUTBOX_PIDFILE"; do
    local label="${item%%:*}"
    local pidfile="${item#*:}"
    if _is_running "$pidfile"; then
      local pid
      pid=$(_get_pid "$pidfile")
      echo -e "  ${GREEN}●${NC} ${label}  PID=$pid  ${GREEN}运行中${NC}"
    else
      echo -e "  ${RED}○${NC} ${label}  ${RED}未运行${NC}"
    fi
  done

  echo ""
  if _is_running "$API_PIDFILE"; then
    local health
    if health=$(python3 - <<PYEOF 2>/dev/null
import json, urllib.request
try:
    r = urllib.request.urlopen('http://${API_HOST}:${API_PORT}/health', timeout=3)
    d = json.loads(r.read())
    print('healthy' if d.get('status') == 'ok' else 'unhealthy')
except Exception:
    print('unreachable')
PYEOF
); then
      case "$health" in
        healthy)    echo -e "  健康检查: ${GREEN}✅ 正常${NC}" ;;
        unhealthy)  echo -e "  健康检查: ${YELLOW}⚠️  异常${NC}" ;;
        *)          echo -e "  健康检查: ${RED}❌ 无法连接${NC}" ;;
      esac
    fi
    echo -e "  API 地址: ${BLUE}http://${API_HOST}:${API_PORT}${NC}"
  fi
}

do_logs() {
  local target="${1:-all}"
  case "$target" in
    api) tail -f "$API_LOG" ;;
    orchestrator) tail -f "$ORCH_LOG" ;;
    dispatch) tail -f "$DISPATCH_LOG" ;;
    outbox) tail -f "$OUTBOX_LOG" ;;
    all) tail -f "$API_LOG" "$ORCH_LOG" "$DISPATCH_LOG" "$OUTBOX_LOG" ;;
    *)
      echo "用法: $0 logs [api|orchestrator|dispatch|outbox|all]"
      exit 1
      ;;
  esac
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 1; do_start ;;
  status)  do_status ;;
  logs)    do_logs "${2:-all}" ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "命令:"
    echo "  start    启动官方后端栈（API + orchestrator + dispatch + outbox）"
    echo "  stop     停止所有服务"
    echo "  restart  重启所有服务"
    echo "  status   查看运行状态"
    echo "  logs     查看日志 (logs [api|orchestrator|dispatch|outbox|all])"
    echo ""
    echo "环境变量:"
    echo "  AGENTORCHESTRATOR_API_HOST  API 监听地址 (默认: 127.0.0.1)"
    echo "  AGENTORCHESTRATOR_API_PORT  API 监听端口 (默认: 8000)"
    exit 1
    ;;
esac
