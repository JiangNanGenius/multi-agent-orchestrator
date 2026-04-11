# 多Agent智作中枢 Windows 安装说明（简明版 + 详细版）

> 适用于 Windows 用户。本文默认你下载的是**已经包含 Windows 兼容修复**的版本，因此不需要再手动改 Python 文件。

---

# 一、最简单版本：照着做就能装

## 1. 下载项目
把项目放到你自己的 OpenClaw workspace 里，例如：

```text
C:\Users\<YOUR_USER>\.openclaw\workspace\skills\agentorchestrator
```

> 你实际目录名可以不是 `agentorchestrator`，但后面命令里的路径要对应修改。

---

## 2. 如果以前装过旧版本，先删除旧链接
如果你之前已经安装过旧版多 Agent 协作工作区，请先检查并删除这些目录里的旧 `data` / `scripts` 链接。当前正式命名体系应以新的 center / specialist 工作区为准：

```text
C:\Users\<YOUR_USER>\.openclaw\workspace-control_center
C:\Users\<YOUR_USER>\.openclaw\workspace-plan_center
C:\Users\<YOUR_USER>\.openclaw\workspace-review_center
C:\Users\<YOUR_USER>\.openclaw\workspace-dispatch_center
C:\Users\<YOUR_USER>\.openclaw\workspace-data_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-docs_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-code_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-audit_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-deploy_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-admin_specialist
C:\Users\<YOUR_USER>\.openclaw\workspace-search_specialist
```

如果你的本地环境里仍残留早期历史命名时期创建的旧 workspace 目录，也建议一并检查并清掉里面遗留的链接，避免它们继续影响当前的 center / specialist 体系部署。
重点删除里面已有的：

- `data`
- `scripts`

如果不清理旧链接，第一次运行安装脚本时，可能会因为“链接已经存在”而失败。

---

## 3. 先让 AI 检查环境，再决定是否执行安装脚本
Windows 下的推荐做法不是一上来就直接运行 `install.ps1`。更稳妥的顺序是：先把本仓库 README、当前 OpenClaw 运行状态、现有 workspace 情况交给 AI 检查，让 AI 判断这是**首次接入**还是**增量更新**，再决定是否执行安装脚本。

在 PowerShell 里先进入项目目录，供 AI 检查当前仓库与环境状态：

```powershell
cd C:\Users\<YOUR_USER>\.openclaw\workspace\skills\agentorchestrator
```

只有当 AI 完成环境评估并明确建议一次性初始化时，才执行下面的脚本作为条件性初始化工具；如果 AI 判断为增量更新，则改走前端构建、配置同步与数据刷新路径：

```powershell
# 仅当 AI 明确建议一次性初始化时再执行
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

## 4. 安装后检查两件事

### A. 检查 agent / subagent 配置是否已在 `openclaw.json` 中可用
当前安装链路会**只读检查** `openclaw.json`，并输出兼容性建议清单，但不会直接覆盖你的现有运行时配置，因此建议你安装后自己确认一次。

如果缺项，可以参考本仓库附带的 `agents.json` 脱敏模板，或直接查看安装产出的建议清单与 Registry 产物。使用时请先把其中的 `<YOUR_USER>` 替换成你自己的系统用户名，再手动补齐对应配置。

### B. 检查 `tools.sessions.visibility = all`
安装脚本会尝试设置，但建议你手动确认一次。

如果没有生效，执行：

```powershell
openclaw config set tools.sessions.visibility all
```

---

## 5. 启动后台刷新循环
在 Git Bash / MINGW64 里运行：

```bash
cd ~/.openclaw/workspace/skills/agentorchestrator/scripts
bash run_loop.sh
```

> 这个脚本负责后台持续刷新数据。

---

## 6. 启动 dashboard
在 PowerShell 里运行：

```powershell
cd C:\Users\<YOUR_USER>\.openclaw\workspace\skills\agentorchestrator
python dashboard\server.py
```

然后浏览器打开：

```text
http://127.0.0.1:7891
```

---

# 二、安装完成后你应该看到什么

正常情况下：

- 面板可以打开
- `Agent 总览` 能显示总控中心、规划中心、评审中心、调度中心与专业执行组信息
- `模型配置` 能显示 agent 列表
- 右上角 Gateway 状态正常
- 倒计时会持续刷新页面数据
- 长任务在接近上下文上限时，会出现“上下文接近上限 / 已压缩 / 可续写”提示

---

# 三、详细说明

## 1. 为什么要先删旧链接

如果你以前已经安装过旧版本，那么：

- `workspace-*\data`
- `workspace-*\scripts`

很可能还指向旧仓库。

这时如果 AI 评估后仍建议走一次性初始化，再按建议运行新的 `install.ps1`，第一次可能出现：

- symlink / junction 创建失败
- 安装脚本看起来跑完了，但实际 workspace 仍然连着旧版本

所以最稳妥的做法是：

## 先删旧链接，再让 AI 判断应走一次性初始化还是增量更新

---

## 2. 为什么安装后还要核对 agent / subagent 配置

在部分环境里，即使 AI 建议执行一次性初始化脚本，它也不会直接改写 `openclaw.json`，因此你仍可能需要依据建议清单手动补齐运行时 Agent 配置。

因此建议你安装后主动确认：

- `control_center`
- `plan_center`
- `review_center`
- `dispatch_center`
- `data_specialist`
- `docs_specialist`
- `code_specialist`
- `audit_specialist`
- `deploy_specialist`
- `admin_specialist`
- `search_specialist`

这些 agent 是否都存在，且 `subagents.allowAgents` 是否正确。

如果安装后看板已能启动，但角色不完整、调度异常或消息不可达，优先检查 `data/openclaw_registry_suggestions.json` 与 Registry / SOUL 产物是否已正确生成，再手动同步到本地运行时配置。

如果缺失，可以直接参考本仓库附带的 `agents.json` 脱敏模板；使用前请先把 `<YOUR_USER>` 替换成你自己的系统用户名。

---

### 3. `agents.json` 是干什么用的

本仓库附带了一个脱敏版的：

```text
agents.json
```

它保留了多Agent智作中枢运行时 Agent 的配置结构，包括：

- `id`
- `name`
- `workspace`
- `agentDir`
- `subagents.allowAgents`

其中路径部分已经用 `<YOUR_USER>` 做了脱敏处理。

使用时请先把：

```text
<YOUR_USER>
```

替换成你自己的 Windows 用户名，再复制到对应配置中。

---

## 4. 为什么还要确认 `tools.sessions.visibility = all`

这个设置会影响 session 工具可见性，对多 agent 协同很重要。

虽然安装脚本会尝试设置，但建议安装后自己再确认一次。

如果没生效，手动执行：

```powershell
openclaw config set tools.sessions.visibility all
```

---

## 5. 为什么还要跑 `run_loop.sh`

dashboard 右上角虽然有一个 5 秒倒计时，但它只是：

- 每 5 秒重新读取一次现有 API 数据

它并不会自动帮你在后台持续生成数据。

真正负责后台数据刷新的是：

```bash
bash run_loop.sh
```

它会持续执行同步脚本，更新：

- `live_status.json`
- `officials_stats.json`
- `agent_config.json`

所以：

- dashboard 倒计时 = **读数据**
- `run_loop.sh` = **产数据 / 刷数据**

Windows 下也建议正常运行 `run_loop.sh`。

---

## 6. 如果 dashboard 提示“请先启动服务器”怎么办

这句文案有时是误导性的。它不一定表示 `dashboard/server.py` 真没启动。

更常见的真实原因是：

- API 返回了空对象
- 读取到了旧仓库的数据
- 当前启动的不是你想要的那个 dashboard server

排查时建议直接访问：

```text
http://127.0.0.1:7891/api/agents-overview
http://127.0.0.1:7891/api/agent-config
http://127.0.0.1:7891/api/live-status
```

如果这三个接口能正常返回 JSON，说明 server 没问题。

---

## 7. 如果 dashboard 提示 Gateway 没启动怎么办

如果你使用的是本修复版，这个问题应该已经被修好。

之前在 Windows 上误报的原因是 dashboard 的 Gateway 检测逻辑偏 Linux。修复后已改为优先使用端口 / probe 检测。

所以如果你仍然看到 Gateway 未启动：

- 先确认自己现在运行的是修复后的 `dashboard/server.py`
- 再确认浏览器访问的不是旧的本地 server 进程

---

# 四、推荐的完整使用顺序

## 第一步
清理旧 `workspace-*` 里的 `data` / `scripts`

## 第二步
运行：

```powershell
# 仅当 AI 明确建议一次性初始化时再执行
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## 第三步
检查：

- agent / subagent 配置
- `tools.sessions.visibility = all`

必要时可参考：

```text
agents.json
```

## 第四步
启动后台刷新循环：

```bash
bash run_loop.sh
```

## 第五步
启动 dashboard：

```powershell
python dashboard\server.py
```

---

# 五、一句话总结

## Windows 用户最稳的做法就是：
先清旧链接，再让 AI 检查当前 OpenClaw 环境与 workspace 状态，并判断应执行一次性初始化还是增量更新路径；安装后根据只读建议核对 `openclaw.json`、确认 `tools.sessions.visibility = all`；如有需要可参考 `agents.json` 脱敏模板并替换 `<YOUR_USER>`；最后启动 `run_loop.sh` 和 `dashboard/server.py`。如果长任务出现上下文接近上限，请在看板任务详情中查看“上下文窗口管理”面板，按归档与续写提示继续执行。


