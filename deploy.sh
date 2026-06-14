#!/bin/bash
# =============================================================================
# Multi-Agent Orchestrator - local deployment helper
# =============================================================================
# This is a conservative wrapper for refreshing an existing local checkout. It
# does not write secrets and keeps runtime data outside git via .gitignore.
# =============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=19

INSTALL_DEPS=true
BUILD_FRONTEND=true
SYNC_CONFIG=true
START_STACK=false
SETUP_HERMES=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
info() { echo -e "${BLUE}$1${NC}"; }
die() { echo -e "${RED}$1${NC}"; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Default behavior:
  install backend dependencies, build frontend when Node.js is new enough,
  refresh generated config files, and stop before starting services.

Options:
  --start          Restart the local backend stack after deployment
  --hermes         Prepare ~/.hermes from this repository via install-hermes.sh
  --no-deps        Skip Python dependency installation
  --no-frontend    Skip frontend install/build
  --no-sync        Skip repository/runtime sync helper scripts
  -h, --help       Show this help

Examples:
  ./deploy.sh
  ./deploy.sh --start
  ./deploy.sh --hermes --start
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START_STACK=true; shift ;;
    --hermes) SETUP_HERMES=true; shift ;;
    --no-deps) INSTALL_DEPS=false; shift ;;
    --no-frontend) BUILD_FRONTEND=false; shift ;;
    --no-sync) SYNC_CONFIG=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

node_meets_floor() {
  local ver major minor
  ver="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%.*}"
  if [[ "${major:-0}" -gt "$NODE_MIN_MAJOR" ]] 2>/dev/null; then
    return 0
  fi
  if [[ "${major:-0}" -eq "$NODE_MIN_MAJOR" && "${minor:-0}" -ge "$NODE_MIN_MINOR" ]] 2>/dev/null; then
    return 0
  fi
  return 1
}

cd "$REPO_DIR"
info "Deploying from $REPO_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  die "python3 is required."
fi

if $INSTALL_DEPS; then
  req_file="$REPO_DIR/agentorchestrator/backend/requirements.txt"
  if [[ -f "$req_file" ]]; then
    info "Installing backend dependencies from $req_file"
    python3 -m pip install --user --disable-pip-version-check -r "$req_file"
  else
    warn "Backend requirements file not found, skipped dependency install."
  fi
fi

if $BUILD_FRONTEND; then
  frontend_dir="$REPO_DIR/agentorchestrator/frontend"
  if [[ -f "$frontend_dir/package.json" ]]; then
    if ! command -v node >/dev/null 2>&1; then
      warn "Node.js not found, skipped frontend build."
    elif ! node_meets_floor; then
      warn "Node.js $(node -v) is below ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+, skipped frontend build."
    else
      info "Building frontend"
      cd "$frontend_dir"
      if command -v pnpm >/dev/null 2>&1 && [[ -f pnpm-lock.yaml ]]; then
        pnpm install --silent || pnpm install
        pnpm build
      else
        npm install --silent 2>/dev/null || npm install
        npm run build
      fi
      cd "$REPO_DIR"
    fi
  fi
fi

if $SYNC_CONFIG; then
  info "Refreshing generated agent config when helpers are available"
  python3 scripts/sync_agent_config.py || warn "sync_agent_config.py returned a warning"
  python3 scripts/sync_agents_overview.py || warn "sync_agents_overview.py returned a warning"
  python3 scripts/refresh_live_data.py || warn "refresh_live_data.py returned a warning"
fi

if $SETUP_HERMES; then
  info "Preparing Hermes Agent profile"
  bash "$REPO_DIR/install-hermes.sh" --non-interactive
fi

if $START_STACK; then
  info "Restarting local backend stack"
  bash "$REPO_DIR/agentorchestrator.sh" restart
else
  log "Deployment refresh complete. Start services with: ./agentorchestrator.sh start"
fi
