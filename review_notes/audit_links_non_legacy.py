from __future__ import annotations

import re
import json
from pathlib import Path
from urllib.parse import urlparse
import requests

ROOT = Path('/home/ubuntu/multi-agent-orchestrator_public')
EXCLUDE_PARTS = {'agentorchestrator', '.git', 'node_modules', '.pytest_cache', '__pycache__'}
TARGET_SUFFIXES = {'.md', '.html'}

MD_LINK_RE = re.compile(r'(!?)\[[^\]]*\]\(([^)]+)\)')
HTML_ATTR_RE = re.compile(r'(?:href|src)=["\']([^"\']+)["\']', re.IGNORECASE)


def is_excluded(path: Path) -> bool:
    return any(part in EXCLUDE_PARTS for part in path.parts)


def iter_targets():
    for path in ROOT.rglob('*'):
        if path.is_file() and path.suffix.lower() in TARGET_SUFFIXES and not is_excluded(path.relative_to(ROOT)):
            yield path


def normalize_target(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith('<') and raw.endswith('>'):
        raw = raw[1:-1].strip()
    return raw


def classify_target(raw: str):
    raw = normalize_target(raw)
    if not raw:
        return 'empty', raw
    lower = raw.lower()
    if lower.startswith(('http://', 'https://')):
        return 'external', raw
    if lower.startswith(('mailto:', 'tel:', 'javascript:', 'data:')):
        return 'skip', raw
    if raw.startswith('#'):
        return 'anchor', raw
    return 'local', raw


def local_exists(base_file: Path, target: str) -> tuple[bool, str]:
    target = target.split('#', 1)[0].split('?', 1)[0].strip()
    if not target:
        return True, ''
    candidate = (base_file.parent / target).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return False, str(candidate)
    return candidate.exists(), str(candidate.relative_to(ROOT))


def check_external(url: str):
    try:
        resp = requests.get(url, timeout=12, allow_redirects=True, headers={'User-Agent': 'Mozilla/5.0 Manus Link Audit'})
        return resp.status_code, resp.url
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def collect_references(text: str, suffix: str):
    refs = []
    if suffix == '.md':
        for is_image, target in MD_LINK_RE.findall(text):
            refs.append({'kind': 'image' if is_image else 'link', 'target': target})
    elif suffix == '.html':
        for target in HTML_ATTR_RE.findall(text):
            refs.append({'kind': 'asset', 'target': target})
    return refs


def main():
    report = []
    external_seen = {}
    for path in iter_targets():
        text = path.read_text(encoding='utf-8', errors='ignore')
        refs = collect_references(text, path.suffix.lower())
        for ref in refs:
            target_type, target = classify_target(ref['target'])
            item = {
                'file': str(path.relative_to(ROOT)),
                'kind': ref['kind'],
                'target': target,
                'type': target_type,
            }
            if target_type == 'local':
                ok, resolved = local_exists(path, target)
                item['ok'] = ok
                item['resolved'] = resolved
            elif target_type == 'external':
                if target not in external_seen:
                    external_seen[target] = check_external(target)
                status, final = external_seen[target]
                item['ok'] = status is not None and 200 <= status < 400
                item['status'] = status
                item['resolved'] = final
            else:
                item['ok'] = True
                item['resolved'] = target
            report.append(item)

    output = {
        'root': str(ROOT),
        'checked_files': sorted({item['file'] for item in report}),
        'problems': [item for item in report if not item['ok']],
        'all_results': report,
    }
    out_path = ROOT / 'review_notes' / 'link_audit_non_legacy_20260411.json'
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(out_path)
    print(f"checked_files={len(output['checked_files'])}")
    print(f"problems={len(output['problems'])}")


if __name__ == '__main__':
    main()
