"""CI 守卫 — 确保 kanban_update.py 和 task.py 的状态转换表完全一致。

如果此测试失败，说明有人只改了一侧的状态机而没有同步另一侧。
kanban_update.py 应通过 _load_canonical_transitions() 从 task.py 动态加载，
但 fallback 定义也必须保持一致。
"""
import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load_pg_transitions() -> dict[str, set[str]]:
    """从 task.py 源码解析 STATE_TRANSITIONS（无需 import，避免 SQLAlchemy 依赖）。"""
    task_py = ROOT / "agentorchestrator" / "backend" / "app" / "models" / "task.py"
    source = task_py.read_text(encoding="utf-8")

    # 提取 TaskState enum 成员名
    enum_names = set(re.findall(r"^\s+(\w+)\s*=\s*\"(\w+)\"", source, re.MULTILINE))
    name_set = {name for name, _ in enum_names}

    # 提取 STATE_TRANSITIONS block — from "STATE_TRANSITIONS = {" to the closing "}"
    m = re.search(r"STATE_TRANSITIONS\s*=\s*\{", source)
    if not m:
        raise ValueError("Cannot find STATE_TRANSITIONS in task.py")

    start = m.start()
    # Find the matching closing brace
    depth = 0
    end = start
    for i, ch in enumerate(source[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    block = source[start:end]

    # Parse: replace TaskState.XXX with "XXX"
    cleaned = re.sub(r"TaskState\.(\w+)", r'"\1"', block)
    # Replace set literal {x, y} that appears as values → ["x", "y"] isn't needed,
    # we can eval as Python since cleaned is now pure str/set literals
    # But we need to replace the outer dict assignment
    cleaned = cleaned.replace("STATE_TRANSITIONS =", "result =")

    local_ns: dict = {}
    exec(cleaned, {}, local_ns)
    raw = local_ns["result"]

    return {state: targets for state, targets in raw.items()}


def test_state_transitions_consistent():
    """kanban _VALID_TRANSITIONS 必须与 task.py STATE_TRANSITIONS 完全一致。"""
    import kanban_update as kb

    pg = _load_pg_transitions()
    json_t = kb._VALID_TRANSITIONS

    # 检查 Postgres 侧每个状态在 JSON 侧都有且一致
    for state, pg_targets in pg.items():
        json_targets = json_t.get(state, set())
        assert json_targets == pg_targets, (
            f"State machine drift at '{state}': "
            f"JSON allows {sorted(json_targets)}, "
            f"Postgres allows {sorted(pg_targets)}"
        )

    # 检查 JSON 侧没有 Postgres 侧不存在的非终态
    for state, json_targets in json_t.items():
        if not json_targets:  # 终态 (Done, Cancelled) 可以只在 JSON 侧有
            continue
        assert state in pg, (
            f"State '{state}' exists in JSON transitions but not in Postgres"
        )


def test_pending_confirm_exists():
    """PendingConfirm 必须在两侧都存在。"""
    import kanban_update as kb

    pg = _load_pg_transitions()
    assert "PendingConfirm" in pg, "PendingConfirm missing from task.py STATE_TRANSITIONS"
    assert "PendingConfirm" in kb._VALID_TRANSITIONS, "PendingConfirm missing from kanban _VALID_TRANSITIONS"


def test_pending_has_outgoing_edges():
    """Pending 不能是死胡同。"""
    pg = _load_pg_transitions()
    assert pg.get("Pending"), "Pending has no outgoing edges in task.py (dead-end)"


def test_terminal_states_have_no_outgoing():
    """Done 和 Cancelled 不应有出边。"""
    pg = _load_pg_transitions()
    assert not pg.get("Done", set()), "Done should have no outgoing edges"
    assert not pg.get("Cancelled", set()), "Cancelled should have no outgoing edges"
