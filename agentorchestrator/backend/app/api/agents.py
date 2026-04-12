"""Agents API — Agent 配置和状态查询。"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger("agentorchestrator.api.agents")
router = APIRouter()

BASE_DIR = Path(__file__).parents[4]
REGISTRY_SPECS_DIR = BASE_DIR / "registry" / "specs"
AGENT_CONFIG_PATH = BASE_DIR / "data" / "agent_config.json"


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("failed reading %s: %s", path, exc)
        return {}


def _load_agent_records() -> list[dict]:
    records: list[dict] = []
    for spec_path in sorted(REGISTRY_SPECS_DIR.glob("*.json")):
        spec = _read_json(spec_path)
        display = spec.get("display") or {}
        agent_id = spec.get("agentId") or spec_path.stem
        records.append({
            "id": agent_id,
            "name": display.get("label") or agent_id,
            "role": display.get("summary") or display.get("roleName") or "",
            "icon": display.get("icon") or "🤖",
        })

    if records:
        return records

    cfg = _read_json(AGENT_CONFIG_PATH)
    for item in cfg.get("agents") or []:
        if not isinstance(item, dict):
            continue
        records.append({
            "id": item.get("id") or "",
            "name": item.get("label") or item.get("id") or "unknown",
            "role": item.get("role") or "",
            "icon": item.get("emoji") or "🤖",
        })
    return [item for item in records if item.get("id")]


@router.get("")
async def list_agents():
    """列出所有可用 Agent。"""
    agents = [
        {
            "id": item["id"],
            "name": item["name"],
            "role": item["role"],
            "icon": item["icon"],
        }
        for item in _load_agent_records()
    ]
    return {"agents": agents}


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取 Agent 详情。"""
    meta = next((item for item in _load_agent_records() if item["id"] == agent_id), None)
    if not meta:
        return {"error": f"Agent '{agent_id}' not found"}, 404

    soul_path = BASE_DIR / "agents" / agent_id / "SOUL.md"
    soul_content = ""
    if soul_path.exists():
        soul_content = soul_path.read_text(encoding="utf-8")[:2000]

    return {
        "id": agent_id,
        "name": meta["name"],
        "role": meta["role"],
        "icon": meta["icon"],
        "soul_preview": soul_content,
    }


@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """获取 Agent 运行时配置。"""
    configs = _read_json(AGENT_CONFIG_PATH)
    agent_items = configs.get("agents") if isinstance(configs, dict) else None
    if isinstance(agent_items, list):
        for item in agent_items:
            if isinstance(item, dict) and item.get("id") == agent_id:
                return {"agent_id": agent_id, "config": item}
    return {"agent_id": agent_id, "config": {}}
