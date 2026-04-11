#!/usr/bin/env python3
"""兼容入口：转发到 agentorchestrator/scripts/task_db.py。"""

from __future__ import annotations

import runpy
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'agentorchestrator' / 'scripts' / 'task_db.py'

if not TARGET.exists():
    raise SystemExit(f'task_db.py not found: {TARGET}')

runpy.run_path(str(TARGET), run_name='__main__')
