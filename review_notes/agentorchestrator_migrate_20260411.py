from __future__ import annotations

from pathlib import Path
import re
import shutil

ROOT = Path('/home/ubuntu/multi-agent-orchestrator_public')
REPORT = ROOT / 'review_notes' / 'agentorchestrator_migration_report_20260411.md'

PATH_RENAMES = [
    ('review_notes/audit_links_non_legacy.py', 'review_notes/audit_links_non_legacy.py'),
    ('review_notes/recheck_markdown_links_non_legacy.py', 'review_notes/recheck_markdown_links_non_legacy.py'),
    ('review_notes/link_audit_non_legacy_20260411.json', 'review_notes/link_audit_non_legacy_20260411.json'),
    ('review_notes/link_audit_non_legacy_postfix_20260411.json', 'review_notes/link_audit_non_legacy_postfix_20260411.json'),
    ('review_notes/task_full_scan_20260411.txt', 'review_notes/agentorchestrator_full_scan_20260411.txt'),
    ('review_notes/task_modernization_delivery_2026-04-10.md', 'review_notes/agentorchestrator_modernization_delivery_2026-04-10.md'),
    ('review_notes/task_residual_check_delivery_20260411.md', 'review_notes/agentorchestrator_residual_check_delivery_20260411.md'),
    ('review_notes/task_scan_summary_20260411.md', 'review_notes/agentorchestrator_scan_summary_20260411.md'),
    ('task_agent_architecture.md', 'agentorchestrator_agent_architecture.md'),
    ('agentorchestrator.sh', 'agentorchestrator.sh'),
    ('agentorchestrator.service', 'agentorchestrator.service'),
    ('agentorchestrator/scripts/kanban_update_agentorchestrator.py', 'agentorchestrator/scripts/kanban_update_agentorchestrator.py'),
    ('agentorchestrator/frontend/src/components/AgentOrchestratorBoard.tsx', 'agentorchestrator/frontend/src/components/AgentOrchestratorBoard.tsx'),
    ('agentorchestrator', 'agentorchestrator'),
]

TEXT_EXTS = {
    '.md', '.txt', '.py', '.sh', '.service', '.json', '.yml', '.yaml', '.ini', '.toml', '.ps1', '.tsx', '.ts', '.js', '.jsx', '.css', '.html', '.svg', '.mmd'
}
TEXT_NAMES = {'Dockerfile', 'Makefile'}
SKIP_DIRS = {'.git', '.pytest_cache', 'node_modules'}

REPLACEMENTS = [
    (r'non_legacy', 'non_legacy'),
    (r'kanban_update_agentorchestrator', 'kanban_update_agentorchestrator'),
    (r'AgentOrchestratorBoard', 'AgentOrchestratorBoard'),
    (r'isAgentOrchestrator', 'isAgentOrchestrator'),
    (r'AGENTORCHESTRATOR_HOME', 'AGENTORCHESTRATOR_HOME'),
    (r'AGENTORCHESTRATOR_DASHBOARD_HOST', 'AGENTORCHESTRATOR_DASHBOARD_HOST'),
    (r'AGENTORCHESTRATOR_DASHBOARD_PORT', 'AGENTORCHESTRATOR_DASHBOARD_PORT'),
    (r'AGENTORCHESTRATOR_', 'AGENTORCHESTRATOR_'),
    (r'agentorchestrator/frontend/src/components/AgentOrchestratorBoard.tsx', 'agentorchestrator/frontend/src/components/AgentOrchestratorBoard.tsx'),
    (r'agentorchestrator/scripts/kanban_update_agentorchestrator.py', 'agentorchestrator/scripts/kanban_update_agentorchestrator.py'),
    (r'agentorchestrator-progress-check-history', 'agentorchestrator-progress-check-history'),
    (r'agentorchestrator-progress-check-history', 'agentorchestrator-progress-check-history'),
    (r'agentorchestrator_locale', 'agentorchestrator_locale'),
    (r'agentorchestrator_token', 'agentorchestrator_token'),
    (r'\btask\b', 'agentorchestrator'),
    (r'\bTask\b', 'AgentOrchestrator'),
    (r'\bTASK\b', 'AGENTORCHESTRATOR'),
]


def is_text_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTS or path.name in TEXT_NAMES


def should_skip(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def rename_paths() -> list[tuple[str, str]]:
    done = []
    for src_rel, dst_rel in PATH_RENAMES:
        src = ROOT / src_rel
        dst = ROOT / dst_rel
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        done.append((src_rel, dst_rel))
    return done


def rewrite_text_files() -> list[str]:
    changed = []
    for path in ROOT.rglob('*'):
        if not path.is_file() or should_skip(path) or not is_text_file(path):
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except Exception:
            continue
        original = text
        for pattern, repl in REPLACEMENTS:
            text = re.sub(pattern, repl, text)
        if text != original:
            path.write_text(text, encoding='utf-8')
            changed.append(str(path.relative_to(ROOT)))
    return changed


def main() -> None:
    renamed = rename_paths()
    changed = rewrite_text_files()
    lines = [
        '# agentorchestrator 迁移执行报告（2026-04-11）',
        '',
        '## 已重命名路径',
        '',
    ]
    if renamed:
        for src, dst in renamed:
            lines.append(f'- `{src}` → `{dst}`')
    else:
        lines.append('- 无路径重命名发生')
    lines.extend(['', '## 已改写文本文件', ''])
    if changed:
        for item in changed:
            lines.append(f'- `{item}`')
    else:
        lines.append('- 无文本文件发生改写')
    REPORT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'renamed={len(renamed)} changed={len(changed)} report={REPORT}')


if __name__ == '__main__':
    main()
