#!/usr/bin/env python3
from __future__ import annotations

import pathlib

from sync_agent_config import (
    BASE,
    SOUL_REQUIRED_SECTIONS,
    build_registry_spec,
    discover_project_agent_ids,
    infer_agent_meta,
    build_default_allow_agents,
    build_runtime_policy,
    build_registry_meta,
    render_soul_from_registry,
)


def has_required_sections(text: str) -> bool:
    return all(section in text for section in SOUL_REQUIRED_SECTIONS)


def build_agent_payload(agent_id: str, candidate_ids: list[str]) -> dict:
    existing_spec = {}
    meta = infer_agent_meta(agent_id, existing_spec)
    return {
        'id': agent_id,
        'label': meta['label'],
        'role': meta['role'],
        'duty': meta['duty'],
        'emoji': meta['emoji'],
        'allowAgents': build_default_allow_agents(agent_id, candidate_ids),
        'runtimePolicy': build_runtime_policy(agent_id),
        'registry': build_registry_meta(agent_id, meta),
        'existingSpec': existing_spec,
        'workspace': '',
        'model': '',
    }


def standardize_source(agent_id: str, path: pathlib.Path, candidate_ids: list[str]) -> bool:
    original = path.read_text(encoding='utf-8', errors='ignore') if path.exists() else ''
    if has_required_sections(original):
        return False

    spec = build_registry_spec(build_agent_payload(agent_id, candidate_ids))
    generated = render_soul_from_registry(spec).rstrip()
    preserved = original.strip()

    if preserved:
        merged = (
            generated
            + '\n\n---\n\n'
            + '## 角色专用细则\n'
            + '以下内容保留该角色原始 SOUL 中的专用流程、领域规则、命令示例与协作约束；执行时必须与上面的标准章节共同生效，不得删减。\n\n'
            + preserved
            + '\n'
        )
    else:
        merged = generated + '\n'

    path.write_text(merged, encoding='utf-8')
    return True


def main() -> None:
    candidate_ids = discover_project_agent_ids()
    agents_dir = BASE / 'agents'
    changed = []
    for agent_id in candidate_ids:
        path = agents_dir / agent_id / 'SOUL.md'
        if standardize_source(agent_id, path, candidate_ids):
            changed.append(agent_id)
    print('standardized=' + ','.join(changed))
    print('count=' + str(len(changed)))


if __name__ == '__main__':
    main()
