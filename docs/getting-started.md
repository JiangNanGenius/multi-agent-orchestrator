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
git clone https://github.com/cft0808/edict.git
cd edict
chmod +x install.sh && ./install.sh
```

安装脚本会自动完成：
- ✅ 创建 12 个 Agent Workspace（`~/.openclaw/workspace-*`）
- ✅ 写入各角色 SOUL.md 人格文件
- ✅ 生成 Registry 规格、SOUL 快照与工作区 sidecar
- ✅ 输出 `openclaw.json` 只读参考下的 Agent 注册建议清单
- ✅ 配置任务数据清洗规则
- ✅ 初始化上下文窗口管理目录、压缩归档落点与续写衔接所需元数据
- ✅ 构建 React 前端到 `dashboard/dist/`（需 Node.js 18+）
- ✅ 初始化数据目录
- ✅ 执行首次数据同步
- ✅ 重启 Gateway 使配置生效

## 第三步：配置消息渠道

在 OpenClaw 中配置消息渠道（Feishu / Telegram / Signal），将 `taizi`（总控中心）Agent 设为任务入口。总控中心会自动分拣闲聊与指令，任务类消息提炼标题后转发规划中心。

```bash
# 查看当前渠道
openclaw channels list

# 添加飞书渠道（入口设为总控中心）
openclaw channels add --type feishu --agent taizi
```

参考 OpenClaw 文档：https://docs.openclaw.ai/channels

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

> 💡 **看板即开即用**：`server.py` 内嵌 `dashboard/dashboard.html`，无需额外构建。Docker 镜像包含预构建的 React 前端。

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
3. **结果归档** — 任务完成后自动归档为交付结果

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

### 订阅情报简报

> 看板 → 情报简报 → ⚙️ 订阅管理 → 选择分类 / 添加源 / 配飞书推送

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
openclaw agents add taizi          # 按提示输入 Anthropic API Key
cd edict && ./install.sh            # 自动同步到所有 Agent，并生成只读建议清单

# 方法二：手动复制 auth 文件
MAIN_AUTH=$(find ~/.openclaw/agents -name auth-profiles.json | head -1)
for agent in taizi zhongshu menxia shangshu hubu libu bingbu xingbu gongbu; do
  mkdir -p ~/.openclaw/agents/$agent/agent
  cp "$MAIN_AUTH" ~/.openclaw/agents/$agent/agent/auth-profiles.json
done

# 方法三：逐个配置
openclaw agents add taizi
openclaw agents add zhongshu
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

- [🏠 项目首页](https://github.com/cft0808/edict)
- [📖 README](../README.md)
- [🤝 贡献指南](../CONTRIBUTING.md)
- [💬 OpenClaw 文档](https://docs.openclaw.ai)
- [📮 公众号 · cft0808](wechat.md) — 架构拆解 / 踩坑复盘 / Token 省钱术

> 说明：当前安装流程会读取 `~/.openclaw/openclaw.json` 识别已有运行时环境，但不会直接改写该文件；如需补齐运行时 Agent 注册，请查看 `data/openclaw_registry_suggestions.json`。长任务的上下文压缩归档与续写衔接状态会写入任务元数据，并同步显示在运行看板与任务详情中。
