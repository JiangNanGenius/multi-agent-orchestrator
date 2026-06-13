#!/usr/bin/env python3
"""
测试 specialist 调用修复
"""
import subprocess
import time
import json
from pathlib import Path

def run_cmd(cmd, timeout=60):
    """执行命令并返回结果"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Timeout"

def test_search_direct():
    """直接测试搜索功能"""
    print("=" * 60)
    print("测试1：直接调用搜索脚本")
    print("=" * 60)

    script = Path("/root/.openclaw/workspace-control_center/skills/volc-search-1.0.0/scripts/search.py")
    if not script.exists():
        print(f"❌ 脚本不存在: {script}")
        return False

    cmd = f'python3 {script} "2026年4月29日 AI新闻" --type web_summary --count 5 --time-range OneDay --need-summary'
    print(f"执行命令: {cmd[:80]}...")

    code, stdout, stderr = run_cmd(cmd, timeout=30)

    if code == 0 and "搜索总结" in stdout:
        print("✅ 搜索成功")
        print(f"结果预览: {stdout[:200]}...")
        return True
    else:
        print(f"❌ 搜索失败，code={code}")
        if stderr:
            print(f"stderr: {stderr[:200]}")
        return False

def test_progress_update():
    """测试 progress 更新"""
    print("\n" + "=" * 60)
    print("测试2：看板进度更新")
    print("=" * 60)

    task_id = "5fe8874d-7c95-4e6b-9827-53309f3af0f8"
    cmd = f'cd /root/.openclaw/workspace-control_center && python3 scripts/task_db.py progress "{task_id}" "测试进度更新；计划：测试🔄" --agent search_specialist'

    print(f"执行命令: {cmd[:100]}...")
    code, stdout, stderr = run_cmd(cmd, timeout=10)

    if code == 0:
        print("✅ 进度更新成功")
        return True
    else:
        print(f"❌ 进度更新失败，code={code}")
        if stderr:
            print(f"stderr: {stderr[:200]}")
        return False

def test_patch_workspace():
    """测试 patch-workspace"""
    print("\n" + "=" * 60)
    print("测试3：工作区元数据更新")
    print("=" * 60)

    task_id = "5fe8874d-7c95-4e6b-9827-53309f3af0f8"
    data = json.dumps({"latest_handoff": "测试更新", "test_field": "test_value"}, ensure_ascii=False)
    cmd = f'cd /root/.openclaw/workspace-control_center && python3 scripts/task_db.py patch-workspace "{task_id}" \'{data}\' --agent search_specialist --summary "测试更新"'

    print(f"执行命令: {cmd[:100]}...")
    code, stdout, stderr = run_cmd(cmd, timeout=10)

    if code == 0:
        print("✅ 工作区更新成功")
        return True
    else:
        print(f"❌ 工作区更新失败，code={code}")
        if stderr:
            print(f"stderr: {stderr[:200]}")
        return False

def test_multi_engines():
    """测试多搜索引擎发现功能"""
    print("\n" + "=" * 60)
    print("测试4：多搜索引擎发现与选择")
    print("=" * 60)

    import sys
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from specialist_executor import get_available_search_engines, select_search_engines

        engines = get_available_search_engines()
        print(f"发现 {len(engines)} 个可用搜索引擎:")
        for e in engines:
            print(f"  - {e['name']} (优先级: {e['priority']}) 特性: {', '.join(e['features'])}")

        if engines:
            # 测试引擎选择逻辑
            test_plan = "搜索新闻并生成总结报告"
            selected = select_search_engines(test_plan, engines)
            print(f"\n针对 '{test_plan}' 选择了 {len(selected)} 个引擎")
            for e in selected:
                print(f"  - {e['name']}")

            print("\n✅ 多搜索引擎功能正常")
            return True
        else:
            print("❌ 没有发现可用搜索引擎")
            return False
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        return False


def main():
    """主函数"""
    print("\n" + "🚀 Specialist 调用修复验证测试")
    print("=" * 60 + "\n")

    results = []
    results.append(("直接搜索", test_search_direct()))
    results.append(("进度更新", test_progress_update()))
    results.append(("工作区更新", test_patch_workspace()))
    results.append(("多搜索引擎", test_multi_engines()))

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    passed = 0
    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {name}: {status}")
        if result:
            passed += 1

    print(f"\n总计: {passed}/{len(results)} 通过")

    if passed == len(results):
        print("\n🎉 所有测试通过！")
        print("\n✅ 修复内容总结：")
        print("  1. search_specialist SOUL.md 已更新启动流程")
        print("  2. dispatch_center SOUL.md 已更新派发说明")
        print("  3. 新增 specialist_executor.py - 通用执行脚本框架")
        print("  4. ✨ 支持多搜索引擎智能选择：volc-search、baidu-search、tencent-search")
        print("  5. 根据任务类型（新闻/摘要/学术）自动选择最优引擎组合")
        print("\n可以创建正式任务验证端到端流程了！")
        return 0
    else:
        print("\n⚠️ 部分测试失败，请检查相关脚本")
        return 1

if __name__ == "__main__":
    exit(main())
