#!/usr/bin/env python3
"""
稳定记录点自动生成脚本
用法:
  # 手动创建
  python3 stable_record.py --title "修复内容" --status "稳定/测试中" --remark "备注信息"

  # 自动判断创建
  python3 stable_record.py --auto --task-id "xxx" --task-code "xxx" --task-state "Doing"

  # 列出记录
  python3 stable_record.py --list --limit 20

  # 检查是否需要创建（用于CI集成）
  python3 stable_record.py --check --task-id "xxx" --context '{"task_progress": 90}'
"""

import argparse
import json
import time
import os
import sys
from datetime import datetime
from pathlib import Path

# 添加服务模块路径
SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent / "agentorchestrator" / "backend"
sys.path.insert(0, str(BACKEND_DIR))

try:
    from app.services.stable_record_service import (
        StableRecordService,
        RecordStatus,
        RuleType,
        Rule,
        RulePriority
    )
    SERVICE_AVAILABLE = True
except ImportError as e:
    SERVICE_AVAILABLE = False
    print(f"警告: 服务模块导入失败: {e}", file=sys.stderr)

RECORD_DIR = os.environ.get("AGENTORCHESTRATOR_STABLE_RECORDS", str(Path.cwd() / "stable_records"))


def create_stable_record(title, status, node, remark, extra_info=None):
    """创建稳定记录点（兼容旧版本）"""
    os.makedirs(RECORD_DIR, exist_ok=True)

    timestamp = datetime.now()
    record_id = f"STABLE_{timestamp.strftime('%Y%m%d_%H%M')}"
    filename = f"{timestamp.strftime('%Y%m%d_%H%M%S')}_{title.replace(' ', '_')[:30]}.json"
    filepath = os.path.join(RECORD_DIR, filename)

    record = {
        "record_id": record_id,
        "title": title,
        "status": status,
        "node": node,
        "saved_at": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "remark": remark,
        "created_by": "auto_script",
    }

    if extra_info and isinstance(extra_info, dict):
        record.update(extra_info)

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=2)

    print(f"✅ 稳定记录点已创建")
    print(f"📄 记录文件: {filepath}")
    print(f"🆔 记录ID: {record_id}")
    print(f"📝 标题: {title}")
    print(f"🔵 状态: {status}")
    print(f"📍 节点: {node}")

    return filepath, record_id


def auto_create_record(args):
    """自动判断并创建记录点"""
    if not SERVICE_AVAILABLE:
        print("❌ 错误: 服务模块不可用，无法使用自动模式", file=sys.stderr)
        return False

    service = StableRecordService()

    # 构建上下文
    context = {
        "task_id": args.task_id,
        "task_code": args.task_code,
        "task_state": args.task_state,
        "task_progress": args.task_progress,
        "task_title": args.task_title,
        "ci_passed": args.ci_passed,
        "test_coverage": args.test_coverage,
        "bug_count": args.bug_count,
        "event_type": args.event_type,
        "message": args.message or "",
        "manual_request": args.manual,
        "node": args.node,
    }

    # 解析额外的上下文JSON
    if args.context:
        try:
            extra_context = json.loads(args.context)
            context.update(extra_context)
        except json.JSONDecodeError as e:
            print(f"⚠️  警告: 上下文JSON解析失败: {e}", file=sys.stderr)

    # 检查模式：只检查不创建
    if args.check:
        should_create, confidence, rules = service.should_create_record(context)
        print(f"是否需要创建: {'是' if should_create else '否'}")
        print(f"置信度: {confidence:.1f}%")
        print(f"触发规则: {', '.join(rules) if rules else '无'}")
        return should_create

    # 自动创建模式
    created, record = service.auto_create_if_needed(
        task_id=args.task_id,
        context=context,
        default_title=args.title
    )

    if created and record:
        print(f"✅ 自动创建稳定记录点成功")
        print(f"🆔 记录ID: {record.record_id}")
        print(f"📝 标题: {record.title}")
        print(f"🔵 状态: {record.status}")
        print(f"📊 置信度: {record.confidence_score}%")
        print(f"🎯 触发规则: {record.trigger_rule}")
        print(f"💡 原因: {record.reason}")
        if record.git_commit:
            print(f"🔗 Git提交: {record.git_commit} ({record.git_branch})")
        return True
    else:
        print(f"ℹ️  不需要创建稳定记录点（未达到触发阈值）")
        return False


def list_records(limit=10, task_id=None):
    """列出最近的稳定记录点"""
    if SERVICE_AVAILABLE:
        service = StableRecordService()
        records = service.list_records(limit=limit, task_id=task_id)

        if not records:
            print("暂无稳定记录点")
            return

        print(f"=== 最近 {len(records)} 个稳定记录点 ===")
        for r in records:
            print(f"\n【{r.status}】{r.title}")
            print(f"    ID: {r.record_id} | 时间: {r.saved_at}")
            print(f"    置信度: {r.confidence_score}% | 触发: {r.trigger_rule}")
            if r.task_code:
                print(f"    任务: {r.task_code}")
            if r.git_commit:
                print(f"    Git: {r.git_commit}")
    else:
        # 兼容旧版本
        if not os.path.exists(RECORD_DIR):
            print("暂无稳定记录点")
            return

        records = []
        for f in os.listdir(RECORD_DIR):
            if f.endswith('.json'):
                filepath = os.path.join(RECORD_DIR, f)
                records.append((os.path.getmtime(filepath), filepath))

        records.sort(reverse=True)

        print(f"=== 最近 {min(limit, len(records))} 个稳定记录点 ===")
        for _, filepath in records[:limit]:
            with open(filepath, 'r', encoding='utf-8') as f:
                r = json.load(f)
            print(f"  [{r.get('status')}] {r.get('title')} @ {r.get('saved_at')}")
            print(f"    ID: {r.get('record_id')} | 节点: {r.get('node')}")


def show_rules():
    """显示所有可用的判断规则"""
    if not SERVICE_AVAILABLE:
        print("❌ 错误: 服务模块不可用", file=sys.stderr)
        return

    service = StableRecordService()

    print("=== 稳定记录点判断规则 ===")
    for i, rule in enumerate(service.rules, 1):
        # 兼容两种Rule结构
        if hasattr(rule, 'priority'):
            priority_map = {RulePriority.LOW: "低", RulePriority.MEDIUM: "中", RulePriority.HIGH: "高"}
            priority_text = priority_map.get(rule.priority, "未知")
        elif hasattr(rule, 'weight'):
            # 根据weight映射优先级
            weight_map = {1.0: "低", 2.0: "中", 3.0: "高"}
            priority_text = weight_map.get(rule.weight, "中")
        else:
            priority_text = "未知"

        threshold = getattr(rule, 'threshold', 60.0)
        config = getattr(rule, 'config', getattr(rule, 'condition', {}))

        print(f"\n{i}. {rule.name} ({rule.rule_id})")
        print(f"   类型: {rule.rule_type} | 优先级: {priority_text} | 阈值: {threshold}%")
        print(f"   说明: {rule.description}")
        if config:
            print(f"   配置: {json.dumps(config, ensure_ascii=False)}")


def main():
    parser = argparse.ArgumentParser(
        description="稳定记录点管理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 手动创建记录点
  python3 stable_record.py --title "用户模块重构完成" --node "code_specialist"

  # 自动判断创建（任务完成时）
  python3 stable_record.py --auto --task-id "xxx" --task-state "Done" --task-progress 100

  # CI集成：测试通过后自动创建
  python3 stable_record.py --auto --ci-passed --test-coverage 85 --node "CI系统"

  # 只检查不创建（用于脚本判断）
  python3 stable_record.py --check --task-id "xxx" --context '{"task_progress": 90}'

  # 列出最近的记录
  python3 stable_record.py --list --limit 20

  # 查看所有判断规则
  python3 stable_record.py --rules
        """
    )

    # 模式选择
    mode_group = parser.add_mutually_exclusive_group(required=False)
    mode_group.add_argument("--auto", action="store_true", help="自动判断是否创建记录点")
    mode_group.add_argument("--check", action="store_true", help="只检查是否需要创建，不实际创建")
    mode_group.add_argument("--list", action="store_true", help="列出最近的记录点")
    mode_group.add_argument("--rules", action="store_true", help="显示所有判断规则")

    # 记录参数
    parser.add_argument("--title", "-t", help="记录标题（手动模式必填）")
    parser.add_argument("--status", "-s", default="稳定运行", help="状态: 稳定运行/测试中/里程碑/热修复/已部署")
    parser.add_argument("--node", "-n", default="system", help="创建节点/角色")
    parser.add_argument("--remark", "-r", default="", help="备注信息")

    # 自动模式参数
    parser.add_argument("--task-id", help="任务ID")
    parser.add_argument("--task-code", help="任务代号")
    parser.add_argument("--task-state", default="Doing", help="任务状态: PlanCenter/ReviewCenter/Doing/Done")
    parser.add_argument("--task-progress", type=int, default=0, help="任务进度百分比 0-100")
    parser.add_argument("--task-title", help="任务标题")
    parser.add_argument("--ci-passed", action="store_true", help="CI测试是否通过")
    parser.add_argument("--test-coverage", type=int, default=0, help="测试覆盖率百分比")
    parser.add_argument("--bug-count", type=int, default=0, help="当前Bug数量")
    parser.add_argument("--event-type", help="事件类型: hotfix/deploy/milestone")
    parser.add_argument("--message", help="上下文消息")
    parser.add_argument("--manual", action="store_true", help="人工请求创建（强制触发）")
    parser.add_argument("--context", type=str, help="JSON格式的额外上下文信息")

    # 列表参数
    parser.add_argument("--limit", type=int, default=10, help="列出记录的数量")

    # 兼容旧参数
    parser.add_argument("--extra", type=json.loads, default="{}", help="(兼容) JSON格式的额外信息")

    args = parser.parse_args()

    # 显示规则
    if args.rules:
        show_rules()
        return

    # 显示规则
    if args.rules:
        show_rules()
        return

    # 列出记录
    if args.list:
        list_records(limit=args.limit, task_id=args.task_id)
        return

    # 自动模式或检查模式
    if args.auto or args.check:
        if not args.task_id and not args.manual:
            print("⚠️  警告: 建议提供 --task-id 以便启用防抖机制", file=sys.stderr)

        result = auto_create_record(args)

        # 对于--check模式，通过退出码表示结果
        if args.check:
            sys.exit(0 if result else 1)

        return

    # 手动创建模式 (提供 --title 时)
    if args.title:
        # 合并额外信息
        extra_info = args.extra or {}
        if args.task_id:
            extra_info["task_id"] = args.task_id
        if args.task_code:
            extra_info["task_code"] = args.task_code

        create_stable_record(args.title, args.status, args.node, args.remark, extra_info)
        return

    # 没有提供任何模式或标题
    print("❌ 错误: 请指定操作模式", file=sys.stderr)
    print("   --title 'xxx'  : 手动创建记录点", file=sys.stderr)
    print("   --auto         : 自动判断创建", file=sys.stderr)
    print("   --list         : 列出记录", file=sys.stderr)
    print("   --rules        : 显示规则", file=sys.stderr)
    print("   --check        : 仅检查不创建", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
