#!/usr/bin/env python3
"""
记录点管理命令行工具
====================

提供记录点的保存、列出、加载、恢复、删除等操作。

用法:
  python3 checkpoint_cli.py save --task-id xxx --reason "里程碑达成"
  python3 checkpoint_cli.py list [--task-id xxx]
  python3 checkpoint_cli.py restore --checkpoint-id xxx
  python3 checkpoint_cli.py delete --checkpoint-id xxx
  python3 checkpoint_cli.py diff --cp1 xxx --cp2 xxx
  python3 checkpoint_cli.py audit [--limit 20]
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# 添加父目录到路径
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from agentorchestrator.checkpoint_manager import (
    CheckpointManager,
    TriggerType,
    ExecutionContext,
    DecisionTrace,
)


def get_manager(workspace_path: str = None) -> CheckpointManager:
    """获取记录点管理器实例"""
    if workspace_path:
        return CheckpointManager(workspace_path)
    # 使用当前工作目录
    return CheckpointManager()


async def cmd_save(args):
    """保存记录点"""
    manager = get_manager(args.workspace)

    # 解析触发类型
    try:
        trigger_type = TriggerType(args.trigger_type)
    except ValueError:
        print(f"❌ 无效的触发类型: {args.trigger_type}")
        print(f"   可选值: {[t.value for t in TriggerType]}")
        return 1

    # 准备执行上下文
    context = ExecutionContext(
        current_step=args.step or "unknown",
        context_variables=json.loads(args.vars) if args.vars else {},
    )

    # 准备决策轨迹
    decision_trace = DecisionTrace(
        reasoning=args.reasoning or "",
        confidence_score=float(args.confidence) if args.confidence else 0.0,
    )

    try:
        checkpoint = await manager.save_checkpoint(
            task_id=args.task_id,
            agent_id=args.agent_id,
            trigger_type=trigger_type,
            trigger_reason=args.reason,
            execution_context=context,
            decision_trace=decision_trace,
            compress=args.compress,
        )

        print(f"✅ 记录点已保存")
        print(f"   ID: {checkpoint.checkpoint_id}")
        print(f"   时间: {checkpoint.timestamp}")
        print(f"   触发类型: {checkpoint.trigger_type}")
        print(f"   原因: {checkpoint.trigger_reason}")
        return 0
    except Exception as e:
        print(f"❌ 保存失败: {e}")
        return 1


async def cmd_list(args):
    """列出记录点"""
    manager = get_manager(args.workspace)
    checkpoints = await manager.list_checkpoints(args.task_id)

    if not checkpoints:
        print("ℹ️  没有找到记录点")
        return 0

    print(f"📋 找到 {len(checkpoints)} 个记录点:\n")

    for i, cp in enumerate(checkpoints, 1):
        status_icon = "✅" if cp["trigger_type"] == "task_success" else \
                      "❌" if cp["trigger_type"] == "task_failure" else \
                      "📍" if cp["trigger_type"] == "critical_node" else \
                      "⏰" if cp["trigger_type"] == "timer" else \
                      "📝"

        print(f"{status_icon} #{i}")
        print(f"   ID: {cp['checkpoint_id']}")
        print(f"   任务ID: {cp['task_id']}")
        print(f"   Agent: {cp['agent_id']}")
        print(f"   时间: {cp['timestamp']}")
        print(f"   触发类型: {cp['trigger_type']}")
        print()

    return 0


async def cmd_restore(args):
    """恢复记录点"""
    manager = get_manager(args.workspace)

    try:
        context = await manager.restore_checkpoint(args.checkpoint_id)

        if not context:
            print(f"❌ 记录点不存在: {args.checkpoint_id}")
            return 1

        print(f"✅ 记录点已恢复")
        print(f"   当前步骤: {context.current_step}")
        print(f"   历史步数: {len(context.step_history)}")
        print(f"   上下文变量数: {len(context.context_variables)}")

        if args.show_vars and context.context_variables:
            print(f"\n   上下文变量:")
            for k, v in context.context_variables.items():
                print(f"     {k}: {v}")

        return 0
    except ValueError as e:
        print(f"⚠️  {e}")
        return 1
    except Exception as e:
        print(f"❌ 恢复失败: {e}")
        return 1


async def cmd_delete(args):
    """删除记录点"""
    manager = get_manager(args.workspace)

    if not args.force:
        confirm = input(f"⚠️  确认删除记录点 {args.checkpoint_id}? (y/N) ")
        if confirm.lower() != 'y':
            print("ℹ️  已取消")
            return 0

    result = await manager.delete_checkpoint(args.checkpoint_id)

    if result:
        print(f"✅ 记录点已删除: {args.checkpoint_id}")
        return 0
    else:
        print(f"❌ 记录点不存在: {args.checkpoint_id}")
        return 1


async def cmd_diff(args):
    """对比两个记录点"""
    manager = get_manager(args.workspace)

    try:
        diff = await manager.diff_checkpoints(args.cp1, args.cp2)

        if "error" in diff:
            print(f"❌ 记录点不存在")
            return 1

        print(f"🔍 记录点对比结果:\n")
        print(f"📌 记录点1: {diff['checkpoint1']['id']}")
        print(f"   时间: {diff['checkpoint1']['timestamp']}")
        print(f"   触发类型: {diff['checkpoint1']['trigger_type']}")
        print()
        print(f"📌 记录点2: {diff['checkpoint2']['id']}")
        print(f"   时间: {diff['checkpoint2']['timestamp']}")
        print(f"   触发类型: {diff['checkpoint2']['trigger_type']}")
        print()
        print(f"⏱️  时间差: {diff['time_diff_seconds']:.2f} 秒")
        print(f"📈 新增步数: {diff['steps_added']}")

        return 0
    except Exception as e:
        print(f"❌ 对比失败: {e}")
        return 1


async def cmd_audit(args):
    """查看审计日志"""
    manager = get_manager(args.workspace)
    audit_file = manager.audit_file

    if not audit_file.exists():
        print("ℹ️  暂无审计日志")
        return 0

    try:
        with open(audit_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # 取最近N条
        lines = lines[-args.limit:]

        print(f"📋 审计日志 (最近 {len(lines)} 条):\n")

        for line in reversed(lines):
            entry = json.loads(line.strip())
            action_icon = {
                "save": "💾",
                "load": "📂",
                "restore": "🔄",
                "delete": "🗑️",
                "tamper_detected": "⚠️",
            }.get(entry["action"], "❓")

            print(f"{action_icon} [{entry['timestamp']}]")
            print(f"   操作: {entry['action']}")
            print(f"   记录点ID: {entry['checkpoint_id']}")

            if entry.get("details"):
                print(f"   详情: {json.dumps(entry['details'], ensure_ascii=False)}")
            print()

        return 0
    except Exception as e:
        print(f"❌ 读取审计日志失败: {e}")
        return 1


async def cmd_auto_check(args):
    """检查是否应该自动保存"""
    manager = get_manager(args.workspace)

    # 构建上下文
    context = {
        "task_completed": args.task_completed,
        "task_failed": args.task_failed,
        "is_critical_node": args.critical_node,
        "milestone_reached": args.milestone,
        "elapsed_since_last_checkpoint": args.elapsed,
        "timer_interval": 300,
        "memory_usage_mb": args.memory,
        "execution_time_seconds": args.exec_time,
        "context_change_magnitude": args.context_change,
    }

    should_save, trigger_type, reason = manager.should_autosave(context)

    print(f"🔍 自动保存检查结果:\n")

    if should_save:
        print(f"✅ 建议保存记录点")
        print(f"   触发类型: {trigger_type.value}")
        print(f"   原因: {reason}")
        return 0
    else:
        print(f"ℹ️  暂时不需要保存记录点")
        print(f"   (如果需要强制保存，请使用 save 命令)")
        return 0


def main():
    parser = argparse.ArgumentParser(
        description="记录点管理命令行工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 checkpoint_cli.py save --task-id mytask --reason "里程碑达成" --trigger-type critical_node
  python3 checkpoint_cli.py list
  python3 checkpoint_cli.py list --task-id mytask
  python3 checkpoint_cli.py restore --checkpoint-id 550e8400-e29b-41d4-a716-446655440000
  python3 checkpoint_cli.py delete --checkpoint-id 550e8400-e29b-41d4-a716-446655440000
  python3 checkpoint_cli.py diff --cp1 id1 --cp2 id2
  python3 checkpoint_cli.py audit
  python3 checkpoint_cli.py auto-check --critical-node
        """,
    )

    parser.add_argument(
        "--workspace", "-w",
        help="工作区路径 (默认: 当前目录)",
    )

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # save 命令
    save_parser = subparsers.add_parser("save", help="保存记录点")
    save_parser.add_argument("--task-id", "-t", required=True, help="任务ID")
    save_parser.add_argument("--agent-id", "-a", default="cli", help="Agent ID")
    save_parser.add_argument("--reason", "-r", required=True, help="保存原因")
    save_parser.add_argument("--trigger-type", default="manual", choices=[t.value for t in TriggerType], help="触发类型")
    save_parser.add_argument("--step", "-s", default="manual_save", help="当前步骤")
    save_parser.add_argument("--vars", default="{}", help="上下文变量 (JSON格式)")
    save_parser.add_argument("--reasoning", default="", help="决策推理过程")
    save_parser.add_argument("--confidence", type=float, default=0.0, help="决策置信度")
    save_parser.add_argument("--compress", action="store_true", help="压缩存储")

    # list 命令
    list_parser = subparsers.add_parser("list", help="列出记录点")
    list_parser.add_argument("--task-id", "-t", help="按任务ID过滤")

    # restore 命令
    restore_parser = subparsers.add_parser("restore", help="恢复记录点")
    restore_parser.add_argument("--checkpoint-id", "-c", required=True, help="记录点ID")
    restore_parser.add_argument("--show-vars", action="store_true", help="显示上下文变量")

    # delete 命令
    delete_parser = subparsers.add_parser("delete", help="删除记录点")
    delete_parser.add_argument("--checkpoint-id", "-c", required=True, help="记录点ID")
    delete_parser.add_argument("--force", "-f", action="store_true", help="不确认直接删除")

    # diff 命令
    diff_parser = subparsers.add_parser("diff", help="对比两个记录点")
    diff_parser.add_argument("--cp1", required=True, help="第一个记录点ID")
    diff_parser.add_argument("--cp2", required=True, help="第二个记录点ID")

    # audit 命令
    audit_parser = subparsers.add_parser("audit", help="查看审计日志")
    audit_parser.add_argument("--limit", "-n", type=int, default=20, help="显示最近N条")

    # auto-check 命令
    auto_parser = subparsers.add_parser("auto-check", help="检查是否应该自动保存")
    auto_parser.add_argument("--task-completed", action="store_true", help="任务是否完成")
    auto_parser.add_argument("--task-failed", action="store_true", help="任务是否失败")
    auto_parser.add_argument("--critical-node", action="store_true", help="是否在关键节点")
    auto_parser.add_argument("--milestone", action="store_true", help="是否达到里程碑")
    auto_parser.add_argument("--elapsed", type=float, default=0, help="距离上次保存的时间(秒)")
    auto_parser.add_argument("--memory", type=float, default=0, help="内存使用(MB)")
    auto_parser.add_argument("--exec-time", type=float, default=0, help="已执行时间(秒)")
    auto_parser.add_argument("--context-change", type=float, default=0, help="上下文变化程度(0-1)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    # 执行对应命令
    cmd_map = {
        "save": cmd_save,
        "list": cmd_list,
        "restore": cmd_restore,
        "delete": cmd_delete,
        "diff": cmd_diff,
        "audit": cmd_audit,
        "auto-check": cmd_auto_check,
    }

    return asyncio.run(cmd_map[args.command](args))


if __name__ == "__main__":
    exit(main())
