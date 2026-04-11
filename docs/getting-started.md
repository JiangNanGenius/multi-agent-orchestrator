# 🚀 快速上手指南

> 从零开始，5 分钟搭建你的多Agent智作中枢协作系统

---

## 第一步：安装 OpenClaw

多Agent智作中枢基于 [OpenClaw](https://openclaw.ai) 运行，请先安装：

```bash
# macOS
brew install openclaw

# 或下载安装包
# https://openclaw.ai/download
```

安装完成后初始化：

```bash
openclaw init
```

## 第二步：克隆并安装多Agent智作中枢

```bash
git clone https://github.com/cft0808/agentorchestrator.git
cd agentorchestrator
chmod +x install.sh && ./install.sh
```

安装脚本会自动完成：
- ✅ 创建 12 个 Agent Workspace（`~/.openclaw/workspace-*`）
- ✅ 写入各角色 SOUL.md 人格文件
- ✅ 生成 Registry 规格、SOUL 快照与工作区 sidecar
- ✅ 输出 `openclaw.json` 只读参考下的 Agent 注册建议清单
- ✅ 基于 `agents/` 目录与现有 Registry 自动发现角色并同步最新配置
- ✅ 配置任务数据清洗规则
- ✅ 初始化上下文窗口管理目录、压缩归档落点与续写衔接所需元数据
- ✅ 构建 React 前端到 `dashboard/dist/`（需 Node.js 18+）
- ✅ 初始化数据目录
- ✅ 执行首次数据同步
- ✅ 重启 Gateway 使配置生效

## 第三步：配置消息渠道

在 OpenClaw 中配置消息渠道（Feishu / Telegram / Signal），将 `control_center`（总控中心）Agent 设为任务入口。总控中心会自动分拣闲聊与指令，任务类消息提炼标题后转发规划中心。

```bash
# 查看当前渠道
openclaw channels list

# 添加飞书渠道（入口设为总控中心）
openclaw channels add --type feishu --agent control_center
```

参考 OpenClaw 文档：https://docs.openclaw.ai/channels

## 部署前建议先做一轮 AI 检查

在首次安装完成或执行增量更新之前，建议先按 `docs/ai_deployment_checklist_and_prompts_20260408.md` 做一轮部署前审计。核心顺序应是：先检查环境与风险，再执行构建与同步，最后做最终交付检查；如果仍有高风险操作、运行时配置覆盖风险或需要停机重启的动作，应先确认再执行。

推荐最小验证顺序如下：

1. `python3 -m py_compile scripts/sync_agent_config.py`
2. `python3 scripts/sync_agent_config.py`
3. 前端改动后执行对应构建检查
4. 必要时重启 Gateway，并确认看板与刷新链路可用

如果你是新增了一个专家角色，只要仓库内新增了 `agents/<agent_id>/SOUL.md`，并补齐必要的 Registry 规格或允许脚本自动推断元数据，就应先运行一次同步脚本，检查该角色是否已进入 `data/agent_config.json`、`registry/specs/` 与对应 workspace，而不是手工修改固定清单。

## 第四步：启动服务

```bash
# 终端 1：数据刷新循环（每 15 秒同步）
bash scripts/run_loop.sh

# 终端 2：看板服务器
python3 dashboard/server.py

# 打开浏览器
open http://127.0.0.1:7891
```

> 💡 **提示**：`run_loop.sh` 每 15 秒自动同步数据。可用 `&` 后台运行。

> 💡 **看板即开即用**：`server.py` 内嵌 `dashboard/dashboard.html`，无需额外构建。

## 第五步：发送第一条任务

通过消息渠道发送任务（总控中心会自动识别并转发到规划中心）：

```
请帮我用 Python 写一个文本分类器：
1. 使用 scikit-learn
2. 支持多分类
3. 输出混淆矩阵
4. 写完整的文档
```

## 第六步：观察执行过程

打开看板 http://127.0.0.1:7891

1. **任务看板** — 观察任务在各状态之间流转，并留意上下文接近上限 / 已压缩 / 可续写提示
2. **运行调度** — 查看各角色工作分布、调度中心直连窗口与实时状态联动
3. **结果归档** — 任务完成后可在看板中归档结果，并进入最终交付检查流程

任务流转路径：
```
收件 → 总控中心预处理 → 规划中心拆解 → 评审中心把关 → 调度中心派发 → 专业执行组处理 → 已完成
```

---

## 🎯 进阶用法

### 使用任务模板

> 看板 → 任务模板 → 选择模板 → 填写参数 → 提交任务

9 个预设模板：周报生成 · 代码审查 · API 设计 · 竞品分析 · 数据报告 · 博客文章 · 部署方案 · 邮件文案 · 站会摘要

### 切换 Agent 模型

> 看板 → ⚙️ 模型配置 → 选择新模型 → 应用更改

约 5 秒后 Gateway 自动重启生效。

### 管理技能

> 看板 → 🛠️ 技能配置 → 查看已安装技能 → 点击添加新技能

### 叫停 / 取消任务

> 在任务看板或任务详情中，点击 **⏸ 叫停** 或 **🚫 取消** 按钮

### 使用 AI 搜索引擎

> 看板 → AI 搜索引擎 → 输入问题 → 选择自动分配或手动多选搜索专家 → 按需展开高级搜索设置

AI 搜索入口现在默认以**低优先级搜索任务**进入系统，适合持续检索、线索汇总与主题跟踪；页面会直接展示搜索专家当前是否忙碌，便于判断是否立即发起搜索任务。

---

## ❓ 故障排查

### 看板显示「服务器未启动」
```bash
# 确认服务器正在运行
python3 dashboard/server.py
```

### Agent 报错 "No API key found for provider"

这是最常见的问题。多Agent智作中枢包含多个 Agent，每个都需要 API Key。

```bash
# 方法一：为任意 Agent 配置后重新运行 install.sh（推荐）
openclaw agents add control_center   # 按提示输入 Anthropic API Key
cd agentorchestrator && ./install.sh             # 自动同步到所有 Agent，并生成只读建议清单

# 方法二：手动复制 auth 文件
MAIN_AUTH=$(find ~/.openclaw/agents -name auth-profiles.json | head -1)
for agent in control_center plan_center review_center dispatch_center docs_specialist data_specialist code_specialist audit_specialist deploy_specialist admin_specialist search_specialist; do
  mkdir -p ~/.openclaw/agents/$agent/agent
  cp "$MAIN_AUTH" ~/.openclaw/agents/$agent/agent/auth-profiles.json
done

# 方法三：逐个配置
openclaw agents add control_center
openclaw agents add plan_center
# ... 其他 Agent
```

### Agent 不响应
```bash
# 检查 Gateway 状态
openclaw gateway status

# 必要时重启
openclaw gateway restart
```

### 数据不更新
```bash
# 检查刷新循环是否运行
ps aux | grep run_loop

# 手动执行一次同步
python3 scripts/refresh_live_data.py
```

### 新增专家未进入运行时 / 看板
```bash
# 先检查同步脚本语法
python3 -m py_compile scripts/sync_agent_config.py

# 重新执行自动发现与同步
python3 scripts/sync_agent_config.py

# 检查是否已生成对应 Registry spec
ls registry/specs | grep <agent-id>
```

如果仓库里已经存在 `agents/<agent-id>/SOUL.md`，但同步后仍未出现对应配置，优先检查该目录命名、SOUL 文件路径与 Registry 规格是否一致；若涉及是否覆盖当前运行时配置或是否立即重启服务，应先确认再继续。

### 上下文窗口接近上限 / 已压缩

当看板出现“上下文接近上限”“高风险”或“已压缩”提示时，说明任务历史过长，系统已开始或即将开始做上下文治理。处理方式如下：

```bash
# 查看最新上下文归档产物
find data -type f | grep -E 'context|archive' | tail -20

# 手动执行一次刷新，更新看板中的上下文状态
python3 scripts/refresh_live_data.py
```

处理建议：
- 优先在任务详情中查看“上下文窗口管理”面板，确认容量占比、已归档条数与续写建议。
- 如任务仍需长链路继续执行，按续写提示发起下一轮，让后续执行基于归档摘要而不是继续累积原始长上下文。
- 若本地运行时 Agent 或权限矩阵尚未补齐，请先根据 `data/openclaw_registry_suggestions.json` 完成只读对接建议，再继续执行。

### 心跳显示红色 / 告警
```bash
# 检查对应 Agent 的进程
openclaw agent status <agent-id>

# 重启指定 Agent
openclaw agent restart <agent-id>
```

### 模型切换后不生效
等待约 5 秒让 Gateway 重启完成。仍不生效则：
```bash
python3 scripts/apply_model_changes.py
openclaw gateway restart
```

---

## 📚 更多资源

- [🏠 项目首页](https://github.com/cft0808/agentorchestrator)
- [📖 README](../README.md)
- [🤝 贡献指南](../CONTRIBUTING.md)
- [💬 OpenClaw 文档](https://docs.openclaw.ai)
- [📝 项目感想与实践复盘](project-reflections.md) — 项目演进中的关键判断、踩坑记录与文档收口说明
- [🧭 架构重写复盘记录](architecture-reflection-notes.md) — 这次协作链路重写的背景、取舍与实现思路
- [🏗️ 当前架构总览](current_architecture_overview.md) — 任务治理链路、面板职责与系统分层说明

> 说明：当前安装流程会读取 `~/.openclaw/openclaw.json` 识别已有运行时环境，但不会直接改写该文件；如需补齐运行时 Agent 注册，请查看 `data/openclaw_registry_suggestions.json`。新增专家角色的同步已优先基于仓库 `agents/` 目录与 Registry 产物自动发现，不再要求先手工维护固定角色清单。长任务的上下文压缩归档与续写衔接状态会写入任务元数据，并同步显示在运行看板与任务详情中。部署前如需让 AI 做结构化审计，请参考 `docs/ai_deployment_checklist_and_prompts_20260408.md`。
