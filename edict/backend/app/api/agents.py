"""Agents API — Agent 配置和状态查询。"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger("edict.api.agents")
router = APIRouter()

# Agent 元信息（对应 agents/ 目录下的 SOUL.md）
AGENT_META = {
    "control_center": {"name": "总控中心", "role": "统一接收任务、判定入口与驱动整体协作", "icon": "🎛️"},
    "plan_center": {"name": "规划中心", "role": "任务拆解、方案规划与执行编排", "icon": "🧭"},
    "review_center": {"name": "评审中心", "role": "方案评审、风险把关与退回修订", "icon": "🔍"},
    "dispatch_center": {"name": "调度中心", "role": "任务派发、协调推进与结果汇总", "icon": "📮"},
    "data_specialist": {"name": "数据专家", "role": "数据分析、指标统计与资源评估", "icon": "💰"},
    "docs_specialist": {"name": "文案专家", "role": "文档撰写、信息表达与对外说明", "icon": "📝"},
    "code_specialist": {"name": "代码专家", "role": "代码实现、技术方案与问题修复", "icon": "💻"},
    "audit_specialist": {"name": "合规专家", "role": "质量审查、测试校验与合规把关", "icon": "⚖️"},
    "deploy_specialist": {"name": "部署专家", "role": "工程交付、自动化与部署实施", "icon": "🧰"},
    "admin_specialist": {"name": "技能管理员", "role": "技能管理、配置维护与运营支持", "icon": "🗂️"},
    "search_specialist": {"name": "搜索专家", "role": "全网搜索、信息检索与线索汇总", "icon": "🌐"},
}


@router.get("")
async def list_agents():
    """列出所有可用 Agent。"""
    agents = []
    for agent_id, meta in AGENT_META.items():
        agents.append({
            "id": agent_id,
            **meta,
        })
    return {"agents": agents}


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取 Agent 详情。"""
    meta = AGENT_META.get(agent_id)
    if not meta:
        return {"error": f"Agent '{agent_id}' not found"}, 404

    # 尝试读取 SOUL.md
    soul_path = Path(__file__).parents[4] / "agents" / agent_id / "SOUL.md"
    soul_content = ""
    if soul_path.exists():
        soul_content = soul_path.read_text(encoding="utf-8")[:2000]

    return {
        "id": agent_id,
        **meta,
        "soul_preview": soul_content,
    }


@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """获取 Agent 运行时配置。"""
    config_path = Path(__file__).parents[4] / "data" / "agent_config.json"
    if not config_path.exists():
        return {"agent_id": agent_id, "config": {}}

    try:
        configs = json.loads(config_path.read_text(encoding="utf-8"))
        agent_config = configs.get(agent_id, {})
        return {"agent_id": agent_id, "config": agent_config}
    except (json.JSONDecodeError, IOError):
        return {"agent_id": agent_id, "config": {}}
