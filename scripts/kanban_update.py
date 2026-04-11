#!/usr/bin/env python3
"""
LEGACY COMPATIBILITY WRAPPER

`scripts/kanban_update.py` 已降级为兼容入口，仅用于旧 JSON 看板模式或历史自动化脚本平滑过渡。
默认任务状态写回主链已统一为 `scripts/task_db.py`。
"""
from __future__ import annotations

import pathlib
import runpy
import sys

LEGACY_IMPL = pathlib.Path(__file__).with_name("legacy_kanban_update.py")

if __name__ == "__main__":
    print(
        "[DEPRECATED] scripts/kanban_update.py 已降级为 legacy 兼容入口；默认请改用 scripts/task_db.py。",
        file=sys.stderr,
    )
    if not LEGACY_IMPL.exists():
        raise SystemExit(f"legacy implementation not found: {LEGACY_IMPL}")
    runpy.run_path(str(LEGACY_IMPL), run_name="__main__")
else:
    if not LEGACY_IMPL.exists():
        raise ImportError(f"legacy implementation not found: {LEGACY_IMPL}")
    exec(compile(LEGACY_IMPL.read_text(encoding="utf-8"), str(LEGACY_IMPL), "exec"), globals(), globals())
