#!/usr/bin/env bash
set -euo pipefail

# Lightweight service watchdog for local deployments.
# Override AGENTORCHESTRATOR_HOME when the script is launched outside the repo.
SCRIPT_DIR="${AGENTORCHESTRATOR_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/watchdog_monitor.log"

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

STATUS="$(./agentorchestrator.sh status 2>&1 || true)"

if printf '%s\n' "$STATUS" | grep -Eiq 'not running|stopped|failed|未运行'; then
    log "Detected stopped services; attempting automatic restart."
    log "Current status: $STATUS"

    ./agentorchestrator.sh restart >> "$LOG_FILE" 2>&1 || true
    sleep 5

    NEW_STATUS="$(./agentorchestrator.sh status 2>&1 || true)"
    if printf '%s\n' "$NEW_STATUS" | grep -Eiq 'not running|stopped|failed|未运行'; then
        log "Automatic recovery failed; services still appear stopped."
    else
        log "Automatic recovery succeeded."
    fi
else
    log "All services appear healthy."
fi
