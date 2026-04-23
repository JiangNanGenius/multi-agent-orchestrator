from __future__ import annotations

import logging
import logging.handlers
import sys
from pathlib import Path
from typing import Iterable

LOG_TARGETS = {"api", "orchestrator", "dispatch", "outbox"}
LOG_MAX_BYTES = 512 * 1024
LOG_BACKUP_COUNT = 4


def get_log_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "logs"


def get_agent_log_path(target: str) -> Path:
    return get_log_dir() / f"{target}.agent.log"


def configure_process_logging(process_name: str, level: int = logging.INFO) -> None:
    """配置统一日志：控制台输出 + 面向 Agent 排错的滚动日志文件。"""
    if process_name not in LOG_TARGETS:
        raise ValueError(f"unsupported log target: {process_name}")

    log_dir = get_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(processName)s] [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        try:
            handler.close()
        except Exception:
            pass

    root.setLevel(level)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(level)
    stream_handler.setFormatter(formatter)

    rotating_handler = logging.handlers.RotatingFileHandler(
        get_agent_log_path(process_name),
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    rotating_handler.setLevel(level)
    rotating_handler.setFormatter(formatter)

    root.addHandler(stream_handler)
    root.addHandler(rotating_handler)

    logging.captureWarnings(True)


def _iter_candidate_log_files(target: str) -> Iterable[Path]:
    base = get_agent_log_path(target)
    candidates = [base]
    candidates.extend(base.parent / f"{base.name}.{idx}" for idx in range(1, LOG_BACKUP_COUNT + 1))
    return [path for path in candidates if path.exists()]


def read_recent_log_lines(target: str, limit: int = 200) -> list[str]:
    if target not in LOG_TARGETS:
        raise ValueError(f"unsupported log target: {target}")

    limit = max(20, min(limit, 400))
    collected: list[str] = []
    for path in _iter_candidate_log_files(target):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        if not lines:
            continue
        collected = lines + collected
        if len(collected) >= limit:
            break
    return collected[-limit:]


def log_runtime_metadata(target: str) -> dict[str, int | str]:
    path = get_agent_log_path(target)
    return {
        "target": target,
        "path": str(path),
        "max_bytes": LOG_MAX_BYTES,
        "backup_count": LOG_BACKUP_COUNT,
        "exists": path.exists(),
        "size_bytes": path.stat().st_size if path.exists() else 0,
    }
