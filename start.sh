#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Multi-Agent Orchestrator · 一键启动脚本（兼容封装）
# 默认转发到新的统一服务脚本，启动 Backend API + Worker 栈
# ══════════════════════════════════════════════════════════════

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${YELLOW}提示：start.sh 已收口为兼容入口，默认会转发到 ./agentorchestrator.sh start${NC}"
echo -e "${BLUE}官方推荐：直接使用 ./agentorchestrator.sh start / status / logs${NC}"

exec bash "$REPO_DIR/agentorchestrator.sh" start
