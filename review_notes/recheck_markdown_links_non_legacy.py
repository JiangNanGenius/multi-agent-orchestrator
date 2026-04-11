#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path('/home/ubuntu/multi-agent-orchestrator_public').resolve()
OUTPUT = ROOT / 'review_notes' / 'link_audit_non_legacy_postfix_20260411.json'
MD_EXTS = {'.md', '.markdown'}
SKIP_PARTS = {'/.git/', '/node_modules/', '/dist/', '/build/', '/.venv/', '/venv/', '/__pycache__/'}
EXCLUDED_PREFIXES = [ROOT / 'agentorchestrator', ROOT / 'agentorchestrator/frontend']

INLINE_PATTERN = re.compile(r'(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
REF_DEF_PATTERN = re.compile(r'^\s*\[([^\]]+)\]:\s+(\S+)', re.MULTILINE)
REF_USE_PATTERN = re.compile(r'(!?)\[[^\]]+\]\[([^\]]+)\]')
AUTOLINK_PATTERN = re.compile(r'<(https?://[^>]+)>')


def is_excluded(path: Path) -> bool:
    path_str = str(path)
    if any(part in path_str for part in SKIP_PARTS):
        return True
    return any(path == pref or pref in path.parents for pref in EXCLUDED_PREFIXES)


def iter_markdown_files():
    for path in ROOT.rglob('*'):
        if not path.is_file():
            continue
        if path.suffix.lower() not in MD_EXTS:
            continue
        if is_excluded(path):
            continue
        yield path


def extract_targets(text: str):
    targets: list[tuple[str, str]] = []
    refs = {m.group(1).strip().lower(): m.group(2).strip() for m in REF_DEF_PATTERN.finditer(text)}
    for m in INLINE_PATTERN.finditer(text):
        kind = 'image' if m.group(1) == '!' else 'link'
        targets.append((kind, m.group(3).strip()))
    for m in REF_USE_PATTERN.finditer(text):
        kind = 'image' if m.group(1) == '!' else 'link'
        key = m.group(2).strip().lower()
        if key in refs:
            targets.append((kind, refs[key]))
    for m in AUTOLINK_PATTERN.finditer(text):
        targets.append(('link', m.group(1).strip()))
    return targets


def check_external(url: str):
    headers = {'User-Agent': 'Mozilla/5.0 Manus link audit'}
    try:
        resp = requests.get(url, headers=headers, timeout=12, allow_redirects=True)
        return resp.ok, resp.status_code, resp.url
    except Exception as exc:  # noqa: BLE001
        return False, None, str(exc)


def check_local(file_path: Path, target: str):
    clean = target.split('#', 1)[0].split('?', 1)[0]
    if not clean:
        return True, str(file_path)
    candidate = (file_path.parent / clean).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return False, str(candidate)
    return candidate.exists(), str(candidate.relative_to(ROOT))


results = []
problems = []
checked_files = []

for md_file in sorted(iter_markdown_files()):
    checked_files.append(str(md_file.relative_to(ROOT)))
    text = md_file.read_text(encoding='utf-8', errors='ignore')
    seen: set[tuple[str, str]] = set()
    for kind, target in extract_targets(text):
        key = (kind, target)
        if key in seen:
            continue
        seen.add(key)
        if target.startswith(('http://', 'https://')):
            ok, status, resolved = check_external(target)
            item = {
                'file': str(md_file.relative_to(ROOT)),
                'kind': kind,
                'target': target,
                'type': 'external',
                'ok': ok,
                'status': status,
                'resolved': resolved,
            }
        else:
            ok, resolved = check_local(md_file, target)
            item = {
                'file': str(md_file.relative_to(ROOT)),
                'kind': kind,
                'target': target,
                'type': 'local',
                'ok': ok,
                'resolved': resolved,
            }
        results.append(item)
        if not item['ok']:
            problems.append(item)

payload = {
    'root': str(ROOT),
    'checked_files': checked_files,
    'problems': problems,
    'all_results': results,
}
OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'checked_files': len(checked_files), 'problems': len(problems), 'output': str(OUTPUT)}, ensure_ascii=False))
