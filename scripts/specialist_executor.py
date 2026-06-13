#!/usr/bin/env python3
"""
Specialist 通用执行器
=====================

当 specialist 被 sessions_spawn 启动后，这个脚本指导它如何执行任务。

使用方式：
1. specialist 启动后，首先从任务消息中提取 task_id 和 workspace_path
2. 读取 PLAN.md 理解任务要求
3. 执行任务（根据 specialist 类型调用对应工具）
4. 将结果写回 artifacts 目录
5. 更新看板进度

支持的 specialist 类型：
- search_specialist: 搜索专家
- code_specialist: 代码专家
- data_specialist: 数据专家
- docs_specialist: 文档专家
- audit_specialist: 审计专家
- deploy_specialist: 部署专家
- admin_specialist: 管理专家
"""

import os
import sys
import json
import time
import subprocess
import argparse
from pathlib import Path

# 添加脚本目录到路径
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
OPENCLAW_HOME = Path(os.environ.get("OPENCLAW_HOME", Path.home() / ".openclaw")).expanduser()
CONTROL_CENTER_SKILLS = Path(
    os.environ.get(
        "OPENCLAW_CONTROL_CENTER_SKILLS",
        OPENCLAW_HOME / "workspace-control_center" / "skills",
    )
).expanduser()


# 工具函数 - 内联实现，避免依赖问题
def run_cmd(cmd, timeout=60):
    """执行命令并返回输出"""
    input_text = None
    if isinstance(cmd, dict):
        input_text = cmd.get("input")
        cmd = cmd.get("args", [])
    use_shell = isinstance(cmd, str)
    try:
        result = subprocess.run(
            cmd,
            shell=use_shell,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            return result.stdout
        else:
            return f"Error: {result.stderr}"
    except subprocess.TimeoutExpired:
        return "Timeout"
    except Exception as e:
        return f"Exception: {str(e)}"


def log_info(msg):
    """打印信息日志"""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] INFO: {msg}")


def log_error(msg):
    """打印错误日志"""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] ERROR: {msg}")


def extract_task_info(message: str) -> dict:
    """从任务消息中提取任务信息

    消息格式通常是：
    调度中心·任务单
    任务ID: xxx
    任务代号: xxx
    工作区: xxx
    任务: [具体内容]
    输出要求: [格式/标准]
    """
    info = {
        "task_id": None,
        "task_code": None,
        "workspace_path": None,
        "task_content": None,
        "output_requirements": None
    }

    lines = message.split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith("任务ID:"):
            info["task_id"] = line.replace("任务ID:", "").strip()
        elif line.startswith("任务代号:"):
            info["task_code"] = line.replace("任务代号:", "").strip()
        elif line.startswith("工作区:"):
            info["workspace_path"] = line.replace("工作区:", "").strip()
        elif line.startswith("任务:"):
            info["task_content"] = line.replace("任务:", "").strip()
        elif line.startswith("输出要求:"):
            info["output_requirements"] = line.replace("输出要求:", "").strip()

    return info


def read_plan_md(workspace_path: str) -> str:
    """读取工作区中的 PLAN.md"""
    plan_path = Path(workspace_path) / "PLAN.md"
    if plan_path.exists():
        return plan_path.read_text(encoding='utf-8')
    return None


def update_progress(task_id: str, content: str, agent: str):
    """更新看板进度"""
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "task_db.py"),
        "progress",
        task_id,
        content,
        "--agent",
        agent,
    ]
    return run_cmd(cmd)


def patch_workspace(task_id: str, data: dict, agent: str, summary: str):
    """更新工作区元数据"""
    import json as json_module
    data_json = json_module.dumps(data, ensure_ascii=False)
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "task_db.py"),
        "patch-workspace",
        task_id,
        data_json,
        "--agent",
        agent,
        "--summary",
        summary,
    ]
    return run_cmd(cmd)


def get_available_search_engines() -> list:
    """获取所有可用的搜索引擎 - 不带硬编码优先级，让模型根据特性智能选择"""
    engines = []

    skills_dir = CONTROL_CENTER_SKILLS

    # 检查 bocha-search
    bocha_script = skills_dir / "bocha-search-1.0.0" / "scripts" / "bocha_search.py"
    if bocha_script.exists():
        engines.append({
            "name": "bocha-search",
            "script": str(bocha_script),
            "features": ["博查AI搜索", "代码搜索", "技术文档", "AI总结", "技术内容最强"],
            "best_for": ["技术问题", "代码查询", "编程错误", "技术文档", "开源项目"],
            "description": "技术/代码搜索能力最强，支持AI总结，适合查询编程、技术架构、开发相关问题"
        })

    # 检查 volc-search
    volc_script = skills_dir / "volc-search-1.0.0" / "scripts" / "search.py"
    if volc_script.exists():
        engines.append({
            "name": "volc-search",
            "script": str(volc_script),
            "features": ["web_summary", "AI总结", "时间过滤", "站点过滤", "短视频内容"],
            "best_for": ["新闻资讯", "热点事件", "实时动态", "短视频内容"],
            "description": "实时新闻搜索和AI总结能力最强，支持时间范围过滤，适合查询最新资讯"
        })

    # 检查 baidu-search
    baidu_script = skills_dir / "baidu-search-1.1.3" / "scripts" / "search.py"
    if baidu_script.exists():
        engines.append({
            "name": "baidu-search",
            "script": str(baidu_script),
            "features": ["百度搜索", "中文搜索", "学术搜索", "全网覆盖"],
            "best_for": ["通用中文搜索", "学术论文", "百度生态内容"],
            "description": "中文全网覆盖最全面，学术搜索能力强，适合通用中文信息查询"
        })

    # 检查 tencent-search
    tencent_script = skills_dir / "tencent-search-1.0.0" / "scripts" / "search.py"
    if tencent_script.exists():
        engines.append({
            "name": "tencent-search",
            "script": str(tencent_script),
            "features": ["腾讯搜索", "行业过滤", "多模态", "微信生态"],
            "best_for": ["行业资讯", "微信生态内容", "多模态搜索"],
            "description": "支持行业垂直过滤，微信生态内容覆盖好，适合特定行业资讯查询"
        })

    # 不按优先级排序，让模型自由选择
    return engines


def fetch_webpage(url: str, timeout: int = 30) -> dict:
    """直接访问网页并提取内容

    Args:
        url: 网页URL
        timeout: 超时时间（秒）

    Returns:
        dict: {"success": bool, "url": str, "title": str, "content": str, "error": str}
    """
    result = {"success": False, "url": url, "title": "", "content": "", "error": ""}

    try:
        import requests
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        response = requests.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        response.encoding = response.apparent_encoding

        soup = BeautifulSoup(response.text, 'html.parser')

        # 提取标题
        title_tag = soup.find('title')
        if title_tag:
            result["title"] = title_tag.get_text(strip=True)

        # 移除不需要的标签
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
            tag.decompose()

        # 提取正文内容
        paragraphs = soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])
        content_parts = []
        for p in paragraphs:
            text = p.get_text(strip=True)
            if len(text) > 20:  # 只保留有意义的段落
                content_parts.append(text)

        result["content"] = "\n\n".join(content_parts[:50])  # 限制长度
        result["success"] = True

    except Exception as e:
        result["error"] = str(e)

    return result


def select_search_engines(plan_md: str, available_engines: list) -> list:
    """根据任务需求智能选择合适的搜索引擎 - 基于引擎特性匹配，不带硬编码优先级"""
    if not available_engines:
        return []

    # 计算每个引擎与任务的匹配度
    engine_scores = []

    for engine in available_engines:
        score = 0
        best_for_keywords = engine.get("best_for", [])
        description = engine.get("description", "")
        features = engine.get("features", [])

        # 基于任务内容和引擎最佳适用场景匹配
        for keyword in best_for_keywords:
            if keyword[:2] in plan_md:  # 匹配关键词前2个字
                score += 10

        # 检查特性匹配
        for feature in features:
            if feature[:2] in plan_md:
                score += 5

        # 新闻/资讯类任务推荐使用多引擎交叉验证
        if "新闻" in plan_md or "资讯" in plan_md or "热点" in plan_md:
            score += 3  # 所有搜索引擎都加分，鼓励交叉验证

        engine_scores.append((engine, score))

    # 按匹配度排序
    engine_scores.sort(key=lambda x: x[1], reverse=True)

    # 选择策略
    selected = []

    # 新闻类：使用所有搜索引擎进行交叉验证
    if "新闻" in plan_md or "资讯" in plan_md or "热点" in plan_md or "最新" in plan_md:
        selected = [e for e, s in engine_scores if s > 0]
        if not selected:
            selected = [e for e, s in engine_scores[:2]]  # 至少选前2个

    # 技术/代码类：优先使用最匹配的 1-2 个技术向引擎
    elif any(k in plan_md for k in ["代码", "技术", "编程", "开发", "报错", "函数", "架构"]):
        selected = [e for e, s in engine_scores if s >= 5]
        if not selected:
            selected = [engine_scores[0][0]]  # 选最匹配的1个

    # 默认：使用匹配度最高的 2 个引擎，兼顾全面性
    else:
        selected = [e for e, s in engine_scores[:2]]

    # 确保至少选择 1 个引擎
    if not selected and available_engines:
        selected = [available_engines[0]]

    return selected


def build_search_command(engine: dict, query: str, time_range: str = None, count: int = 10):
    """根据搜索引擎构建搜索命令"""
    script = engine["script"]

    if engine["name"] == "bocha-search":
        return [sys.executable, script, query, "--ai", "--count", str(count)]

    elif engine["name"] == "volc-search":
        cmd = [sys.executable, script, query, "--type", "web_summary", "--count", str(count), "--need-summary"]
        if time_range:
            cmd.extend(["--time-range", time_range])
        return cmd

    elif engine["name"] == "tencent-search":
        # 腾讯使用时间戳，暂时不加时间过滤
        return [sys.executable, script, query, "--count", str(count)]

    elif engine["name"] == "baidu-search":
        # 百度搜索需要 JSON 请求体，通过 stdin 传入，避免 shell 拼接。
        return {
            "args": [sys.executable, script],
            "input": json.dumps({"query": query}, ensure_ascii=False),
        }

    else:
        return [sys.executable, script, query]


def extract_search_queries(plan_md: str) -> list:
    """从 PLAN.md 中提取搜索关键词"""
    queries = []

    # 默认搜索词
    default_queries = [
        "2026年4月29日 重大新闻",
        "2026年4月29日 财经新闻",
        "2026年4月29日 科技新闻",
        "2026年4月29日 国际新闻"
    ]

    if not plan_md:
        return default_queries[:2]  # 默认返回前2个

    plan_lower = plan_md.lower()

    # 根据内容定制搜索词
    if "AI" in plan_md or "人工智能" in plan_md:
        queries.append("2026年4月29日 AI 人工智能 新闻")

    if "财经" in plan_md or "经济" in plan_md or "金融" in plan_md:
        queries.append("2026年4月29日 财经 经济 新闻")

    if "科技" in plan_md or "技术" in plan_md:
        queries.append("2026年4月29日 科技 技术 新闻")

    if "国际" in plan_md or "全球" in plan_md:
        queries.append("2026年4月29日 国际 全球 新闻")

    # 如果没有提取到特定搜索词，使用默认
    if not queries:
        queries = default_queries[:3]

    return queries


def execute_search_specialist(task_info: dict, plan_md: str) -> dict:
    """执行搜索专家任务 - 支持多搜索引擎智能选择 + 网页直接访问"""
    task_id = task_info["task_id"]
    workspace_path = task_info["workspace_path"]

    log_info(f"[search_specialist] 开始执行搜索任务: {task_id}")
    update_progress(task_id, "搜索专家已接单，正在分析搜索需求；计划：接单✅|分析需求🔄|选择引擎|执行搜索|网页抓取|整理结果|交付", "search_specialist")

    # 获取可用搜索引擎
    available_engines = get_available_search_engines()
    log_info(f"[search_specialist] 可用搜索引擎: {[e['name'] for e in available_engines]}")

    if not available_engines:
        error_msg = "没有可用的搜索引擎"
        log_error(error_msg)
        update_progress(task_id, f"搜索失败：{error_msg}", "search_specialist")
        return {"status": "failed", "error": error_msg}

    # 根据任务需求选择搜索引擎
    selected_engines = select_search_engines(plan_md, available_engines)
    log_info(f"[search_specialist] 已选择搜索引擎: {[e['name'] for e in selected_engines]}")

    # 提取搜索关键词
    queries = extract_search_queries(plan_md)

    # 创建 artifacts 目录
    artifacts_dir = Path(workspace_path) / "artifacts"
    artifacts_dir.mkdir(exist_ok=True)

    update_progress(task_id, f"已选择 {len(selected_engines)} 个搜索引擎，{len(queries)} 个搜索关键词；计划：接单✅|分析需求✅|选择引擎✅|执行搜索🔄|网页抓取|整理结果|交付", "search_specialist")

    # 执行多引擎、多轮搜索
    all_results = []
    webpage_results = []
    total_searches = len(selected_engines) * len(queries)
    current_search = 0

    for engine in selected_engines:
        for query in queries:
            current_search += 1
            update_progress(task_id, f"正在执行 [{engine['name']}] 搜索 ({current_search}/{total_searches})：{query[:30]}；计划：接单✅|分析需求✅|选择引擎✅|执行搜索🔄|网页抓取|整理结果|交付", "search_specialist")

            cmd = build_search_command(engine, query, time_range="OneDay", count=8)
            result = run_cmd(cmd, timeout=60)

            if result and len(result) > 100:  # 至少有一定长度的结果才保存
                all_results.append({
                    "engine": engine["name"],
                    "query": query,
                    "result": result
                })

    # 检查是否需要网页直接访问（根据搜索结果提取URL）
    # 这里我们演示性地抓取一些重要新闻链接
    need_web_fetch = "网页" in plan_md or "详情" in plan_md or len(all_results) < 3

    if need_web_fetch:
        update_progress(task_id, f"正在进行网页直接访问，获取深度内容；计划：接单✅|分析需求✅|选择引擎✅|执行搜索✅|网页抓取🔄|整理结果|交付", "search_specialist")

        # 演示性网页抓取（实际应用中可从搜索结果中提取URL）
        demo_urls = [
            # 可根据实际搜索结果提取的URL进行抓取
        ]

        for url in demo_urls[:3]:  # 最多抓取3个网页
            result = fetch_webpage(url)
            if result["success"]:
                webpage_results.append(result)
                log_info(f"[search_specialist] 成功抓取网页: {result['title'][:50]}")

    # 生成搜索结果报告
    report_content = "# 搜索结果汇总报告\n\n"
    report_content += f"**任务ID**: {task_id}\n"
    report_content += f"**搜索时间**: 2026年4月29日\n"
    report_content += f"**使用引擎**: {', '.join([e['name'] for e in selected_engines])}\n"
    report_content += f"**搜索轮次**: {len(all_results)} 轮有效搜索\n"
    if webpage_results:
        report_content += f"**网页抓取**: {len(webpage_results)} 个网页\n"
    report_content += "\n## 搜索结果详情\n\n"

    for i, item in enumerate(all_results):
        report_content += f"### {i+1}. [{item['engine']}] {item['query'][:30]}\n\n"
        report_content += f"```\n{item['result'][:3000]}\n```\n\n"  # 限制每个结果长度

    # 添加网页抓取结果
    if webpage_results:
        report_content += "\n## 📄 网页深度抓取结果\n\n"
        for i, wp in enumerate(webpage_results):
            report_content += f"### {i+1}. {wp['title'][:50]}\n\n"
            report_content += f"**URL**: {wp['url']}\n\n"
            report_content += f"**内容摘要**:\n\n{wp['content'][:1000]}...\n\n"

    report_path = artifacts_dir / "search_results.md"
    report_path.write_text(report_content, encoding='utf-8')

    update_progress(task_id, f"搜索完成，共 {len(all_results)} 轮有效搜索{' + ' + str(len(webpage_results)) + ' 个网页深度抓取' if webpage_results else ''}，结果已写入 artifacts/search_results.md；计划：接单✅|分析需求✅|选择引擎✅|执行搜索✅|网页抓取✅|整理结果✅|交付🔄", "search_specialist")

    patch_workspace(task_id, {
        "latest_handoff": "搜索专家已完成搜索任务，结果已写入工作区",
        "search_summary": f"使用 {len(selected_engines)} 个引擎完成 {len(all_results)} 轮搜索{'，' + str(len(webpage_results)) + ' 个网页深度抓取' if webpage_results else ''}，结果已保存至 artifacts/search_results.md",
        "search_engines_used": [e['name'] for e in selected_engines],
        "webpages_fetched": len(webpage_results),
        "web_fetch_enabled": True
    }, "search_specialist", "搜索任务完成")

    log_info(f"[search_specialist] 任务完成：{task_id}")

    return {
        "status": "success",
        "output": str(report_path),
        "engines_used": [e['name'] for e in selected_engines],
        "search_count": len(all_results),
        "webpages_fetched": len(webpage_results),
        "summary": f"使用 {len(selected_engines)} 个引擎完成 {len(all_results)} 轮搜索，结果已保存至 artifacts/search_results.md"
    }


def main():
    parser = argparse.ArgumentParser(description='Specialist 执行器')
    parser.add_argument('--agent', required=True, help='Agent 类型：search_specialist, code_specialist 等')
    parser.add_argument('--task-id', help='任务 ID（如果已知）')
    parser.add_argument('--workspace', help='工作区路径（如果已知）')
    parser.add_argument('--message', help='任务消息')

    args = parser.parse_args()

    # 提取任务信息
    task_info = {}
    if args.message:
        task_info = extract_task_info(args.message)

    if args.task_id:
        task_info["task_id"] = args.task_id
    if args.workspace:
        task_info["workspace_path"] = args.workspace

    # 验证必要信息
    if not task_info.get("task_id"):
        print("错误: 缺少 task_id")
        return 1

    if not task_info.get("workspace_path"):
        print("错误: 缺少 workspace_path")
        return 1

    # 读取 PLAN.md
    plan_md = read_plan_md(task_info["workspace_path"])

    # 根据 specialist 类型执行任务
    agent_type = args.agent

    if agent_type == "search_specialist":
        result = execute_search_specialist(task_info, plan_md)
    else:
        # 默认处理：记录日志，不执行实际操作
        log_info(f"[{agent_type}] 收到任务，但该类型暂未实现完整执行逻辑")
        update_progress(task_info["task_id"], f"{agent_type} 收到任务，正在开发中；计划：接单✅|开发中", agent_type)
        result = {
            "status": "partial",
            "message": f"{agent_type} 执行逻辑正在开发中"
        }

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
