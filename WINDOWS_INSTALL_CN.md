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
bash ./agentorchestrator.sh start
```

然后浏览器打开：

```text
http://127.0.0.1:8000
```

如需仅为兼容核验额外启用旧看板，可执行：

```powershell
$env:AGENTORCHESTRATOR_ENABLE_LEGACY_DASHBOARD="1"
bash ./agentorchestrator.sh start
```

此时兼容看板地址才是：

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

在部分环境里，如果本地 OpenClaw 配置与仓库要求差异较大，安装流程会尝试自动补齐 `openclaw.json` 中所需的运行时 Agent 配置，并在重启与校验失败时直接报错中止。

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

如果安装后服务已能启动，但角色不完整、调度异常或消息不可达，优先检查 `data/openclaw_registry_suggestions.json`、Registry 产物以及自动补齐后的本地运行时配置；该文件现在主要用于记录诊断与失败原因，而不是要求你先手工补录。

如果仍需人工对照，可以参考本仓库附带的 `agents.json` 脱敏模板；使用前请先把 `<YOUR_USER>` 替换成你自己的系统用户名。

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

## 5. 为什么现在不再单独强调 `run_loop.sh`

新的官方入口 `./agentorchestrator.sh start` 会直接拉起后端 API 与后台 worker 栈，因此默认不再要求你额外手动执行 `run_loop.sh` 才能看到核心数据更新。

只有在做旧版看板兼容排查、脚本级调试或对比历史行为时，才需要单独运行相关辅助脚本。

所以现在应优先理解为：

- `agentorchestrator.sh start` = **官方主入口，负责起服务与后台处理链路**
- 兼容脚本 / 旧看板 = **仅用于排障、对比或过渡验证**

---

## 6. 如果页面提示服务未就绪怎么办

这类提示不一定表示主服务真的没有启动，更常见的原因是：

- 后端 API 尚未完全就绪
- 读取到了旧仓库或旧工作区数据
- 当前打开的是兼容看板而不是主入口

排查时建议先直接访问主 API：

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/api/agents-overview
http://127.0.0.1:8000/api/live-status
```

如果这些接口能正常返回 JSON，说明主服务基本正常。只有在你明确启用了兼容看板时，才再检查 `http://127.0.0.1:7891` 下的兼容接口。

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


