#!/bin/bash
# =============================================================================
# Multi-Agent Orchestrator - Hermes Agent setup helper
# =============================================================================
# Creates a Hermes Agent profile from this public snapshot without copying any
# secrets into the repository. Existing ~/.hermes files are preserved unless
# --overwrite is passed.
# =============================================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
MODEL_ID="${HERMES_MODEL_ID:-anthropic/claude-sonnet-4-20250514}"
PROVIDER="${HERMES_PROVIDER:-auto}"

INSTALL_HERMES=false
OVERWRITE=false
NON_INTERACTIVE=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
info() { echo -e "${BLUE}$1${NC}"; }
die() { echo -e "${RED}$1${NC}"; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./install-hermes.sh [options]

Options:
  --install             Install Hermes Agent if the hermes command is missing
  --overwrite           Replace existing ~/.hermes config/personality files after backup
  --non-interactive     Do not prompt; skip optional install if hermes is missing
  --model <id>          Set model.default in config.yaml
  --provider <name>     Set model.provider in config.yaml
  -h, --help            Show this help

Environment:
  HERMES_HOME           Target Hermes profile directory, default ~/.hermes
  HERMES_MODEL_ID       Default model id used when --model is not passed
  HERMES_PROVIDER       Default provider used when --provider is not passed
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL_HERMES=true; shift ;;
    --overwrite) OVERWRITE=true; shift ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --model) MODEL_ID="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [[ -z "$MODEL_ID" || -z "$PROVIDER" ]]; then
  die "Model and provider cannot be empty."
fi

confirm() {
  local prompt="$1"
  if $NON_INTERACTIVE; then
    return 1
  fi
  read -r -p "$prompt (y/N) " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

backup_if_needed() {
  local target="$1"
  if [[ -e "$target" ]]; then
    local backup="${target}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -R "$target" "$backup"
    info "Backed up $target -> $backup"
  fi
}

copy_file() {
  local source="$1"
  local target="$2"
  if [[ -e "$target" && "$OVERWRITE" != "true" ]]; then
    warn "Kept existing $target"
    return 1
  fi
  backup_if_needed "$target"
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
  return 0
}

if command -v hermes >/dev/null 2>&1; then
  info "Hermes Agent detected: $(hermes --version 2>/dev/null || echo unknown)"
else
  if $INSTALL_HERMES || confirm "Hermes Agent is missing. Install it now"; then
    curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
    export PATH="$HOME/.hermes/bin:$PATH"
  fi
  if ! command -v hermes >/dev/null 2>&1; then
    warn "Hermes command is not available. Profile files will still be prepared."
  fi
fi

mkdir -p "$HERMES_HOME" "$HERMES_HOME/personalities" "$HERMES_HOME/context"

CONFIG_SOURCE="$REPO_DIR/hermes.example.yaml"
CONFIG_TARGET="$HERMES_HOME/config.yaml"
[[ -f "$CONFIG_SOURCE" ]] || die "Missing $CONFIG_SOURCE"

if copy_file "$CONFIG_SOURCE" "$CONFIG_TARGET"; then
  CONFIG_TARGET="$CONFIG_TARGET" MODEL_ID="$MODEL_ID" PROVIDER="$PROVIDER" python3 <<'PYEOF'
import os
import pathlib
import re

path = pathlib.Path(os.environ["CONFIG_TARGET"])
text = path.read_text(encoding="utf-8")
text = re.sub(r'(^\s*default:\s*)".*?"', rf'\1"{os.environ["MODEL_ID"]}"', text, count=1, flags=re.M)
text = re.sub(r'(^\s*provider:\s*)".*?"', rf'\1"{os.environ["PROVIDER"]}"', text, count=1, flags=re.M)
path.write_text(text, encoding="utf-8", newline="\n")
PYEOF
  log "Wrote $CONFIG_TARGET"
fi

ENV_SOURCE="$REPO_DIR/configs/hermes/env.example"
ENV_TARGET="$HERMES_HOME/.env"
if [[ -f "$ENV_SOURCE" ]]; then
  if copy_file "$ENV_SOURCE" "$ENV_TARGET"; then
    log "Wrote $ENV_TARGET"
    warn "Fill $ENV_TARGET with your own model and channel credentials before starting Hermes."
  fi
fi

generated=0
skipped=0
shopt -s nullglob
for soul in "$REPO_DIR"/agents/*/SOUL.md; do
  agent_id="$(basename "$(dirname "$soul")")"
  target="$HERMES_HOME/personalities/${agent_id}.md"
  if [[ -e "$target" && "$OVERWRITE" != "true" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  backup_if_needed "$target"
  {
    echo "# ${agent_id}"
    echo
    echo "> Generated from Multi-Agent Orchestrator agents/${agent_id}/SOUL.md."
    echo
    cat "$soul"
  } > "$target"
  generated=$((generated + 1))
done

if [[ -f "$REPO_DIR/agents/GLOBAL.md" ]]; then
  global_target="$HERMES_HOME/context/AGENTS.md"
  if copy_file "$REPO_DIR/agents/GLOBAL.md" "$global_target"; then
    log "Wrote $global_target"
  fi
fi

log "Hermes personality sync complete: generated=$generated skipped=$skipped"
echo ""
echo "Next steps:"
echo "  1. Edit credentials:      $ENV_TARGET"
echo "  2. Review config:         $CONFIG_TARGET"
echo "  3. Run Hermes setup:      hermes setup"
echo "  4. Start CLI or gateway:  hermes  /  hermes gateway start"
