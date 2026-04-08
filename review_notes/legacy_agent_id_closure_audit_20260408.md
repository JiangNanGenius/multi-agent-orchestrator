# 无兼容全量命名重构未收口审计（2026-04-08）

## 结论

本轮核查可以明确确认：当前仓库里 **agents 目录本身已经切到新命名体系**，也就是 `control_center`、`plan_center`、`review_center`、`dispatch_center` 与各类 `*_specialist` 目录已经成为项目内正式 SOUL 源文件所在位置；但是整个项目 **并没有完成“无兼容的全量命名体系重构”的最后收口**。问题不在于 `agents/` 目录继续保留了旧目录，而在于 **Registry 生成产物、运行时刷新脚本、前端面板、安装脚本与部分文档** 仍然保留旧 `agent_id`、旧入口别名或兼容说明，因此造成“看起来已经现代化，但底层仍残留旧体系”的状态。

更直接地说，当前的残留不是单点漏改，而是 **收口动作没有做完**：新体系已经建立，但旧体系的产物清理、兼容分支删除、历史输出淘汰、文档示例替换，没有作为一个完整的最后阶段执行到底。

## 关键发现

| 检查对象 | 现状 | 判断 |
| --- | --- | --- |
| `agents/*/SOUL.md` | 仅存在现代命名目录，共 11 个 agent | 项目正式 SOUL 源目录已基本完成重构 |
| `registry/specs/*` | 同时存在现代 ID 与旧 ID，如 `main`、`taizi`、`zhongshu`、`hubu` 等 | **旧 Registry 产物未清理** |
| `registry/generated/*` | 同时存在现代 SOUL 快照与旧 SOUL 快照 | **旧生成产物未清理** |
| `data/agent_config.json` | 当前运行态已是现代 ID 列表 | 运行态主输入已基本切新 |
| `scripts/refresh_live_data.py` | 仍保留 `control_center` / `main` 别名兼容 | **运行链路仍有旧 ID 兼容** |
| `dashboard/dashboard.html` | 仍显式跳过 `main`，保留 `_agentLabels.main`、`_mainRefreshTimer` 等历史命名 | **前端仍有旧主入口语义** |
| `docs/getting-started.md` | 仍示例 `taizi`、`zhongshu` 等旧 ID | **部署文档未收口** |
| `install.ps1` | 仍优先从 `agents/main/agent` 搜索认证文件 | **安装链路仍以旧入口命名为默认假设** |

## 为什么会出现“agents 目录已经新了，但 registry 里还是旧的”

### 1. 旧 Registry 文件不是当前输入生成的，而是历史产物没有被清理

`scripts/sync_agent_config.py` 当前的候选 agent 来源是三部分拼接：

1. `DEFAULT_AGENT_META.keys()`
2. `discover_project_agent_ids()` 扫描 `agents/*/SOUL.md`
3. 运行时配置里的 `agents_list`

当前项目内：

- `DEFAULT_AGENT_META` 只包含现代 ID；
- `agents/` 目录只包含现代 ID；
- `agents.json` 回退源也只包含现代 ID。

这意味着 **旧 ID 并不是当前同步输入的一部分**。因此 `registry/specs/taizi.json`、`registry/specs/main.json`、`registry/generated/zhongshu.SOUL.md` 一类文件，按现有代码逻辑判断，应是 **先前生成后遗留在目录中的历史产物**，而不是本轮同步仍在主动生成的新结果。

真正的问题在于：`write_registry_artifacts()` 只会“写入当前结果”，不会“删除已过时结果”。也就是说，它缺少一段 **obsolete artifact cleanup** 逻辑，所以旧文件会一直留在 `registry/specs/` 与 `registry/generated/` 中，形成“仓库里仍然存在旧体系”的假象，甚至误导后续维护者。

## 仍然存在的旧命名依赖链路

### 1. Registry 侧仍存在旧 ID 规格与旧路由拓扑

`registry/specs/main.json` 直接证明旧体系仍被保留为一等产物。该文件虽然把展示层写成“总控中心 / 总控专家”，但内部仍保留：

| 字段 | 旧残留 |
| --- | --- |
| `agentId` | `main` |
| `identity.downstream` | `zhongshu`、`menxia`、`shangshu`、`hubu`、`libu`、`bingbu`、`xingbu`、`gongbu`、`libu_hr` |
| `routing.allowedTargets` | 同样是旧链路 |
| `deployment.projectSourcePath` | `agents/main/SOUL.md` |
| `deployment.workspaceTargetPath` | `~/.openclaw/workspace-main/soul.md` |
| `deployment.legacyTargets` | `~/.openclaw/agents/main/SOUL.md` |

这说明当时的做法是：**把显示文案改成现代体系，但没有把运行身份与部署路径一起切断**。这就是为什么用户会感觉“现代化了，但底层还是旧的”。

### 2. `refresh_live_data.py` 仍保留 `main` 兼容入口

刷新脚本中存在如下兼容逻辑：

- `CONTROL_CENTER_ALIAS = {'control_center', 'main'}`
- `resolve_runtime_profile()` 中，如果命中别名，则在 `control_center` 与 `main` 之间互相回退
- `build_agent_statuses()` 中，如果当前 agent 没有任务且属于控制中心别名，会从另一别名补取任务
- `runtimeSummary.systemRepairScope` 中仍回退读取 `main`

这意味着 **运行时聚合层尚未完成从 `main` 到 `control_center` 的完全切断**。只要这层兼容在，历史任务或历史运行数据就仍可带着旧 ID 穿透到看板数据聚合层。

### 3. 前端页面仍保留“主入口 = main”的历史结构痕迹

`dashboard/dashboard.html` 里至少还有三类明显残留：

| 位置 | 残留内容 | 含义 |
| --- | --- | --- |
| agent 列表过滤 | `a.id !== 'main'` | 仍把 `main` 当作特殊根节点 |
| 标签映射 | `_agentLabels = { main:'总控中心', control_center:'总控中心', ... }` | 前端仍兼容旧 ID |
| 变量命名 | `_mainRefreshTimer`、`_mainRefreshBusy`、`MAIN_REFRESH_SECONDS` | 语义上仍以“main”为主入口命名 |

这里最关键的不是变量名本身，而是它反映出 **页面逻辑依然把“main 入口”视为曾经真实存在且需要继续回避/兼容的实体**。

### 4. 安装与部署脚本仍默认旧入口目录

`install.ps1` 中认证文件同步仍优先从：

`$OC_HOME\agents\main\agent`

读取 `models.json` 或 `auth-profiles.json`。这说明安装脚本仍假设 `main` 是默认主 Agent 目录。若用户做的是无兼容全量重构，这个默认入口就应该改成 `control_center`，或者改成“从现代 agent 列表中自动发现第一个已配置中心节点”，而不是继续钉死在 `main`。

### 5. 部署文档仍在教用户使用旧 agent_id

`docs/getting-started.md` 仍明确写着：

- “将 `taizi`（总控中心）Agent 设为任务入口”
- `openclaw channels add --type feishu --agent taizi`
- API Key 配置与循环示例中仍使用 `taizi zhongshu menxia shangshu hubu libu bingbu xingbu gongbu`

这会直接把新部署继续带回旧命名体系，因此它不是小问题，而是 **会重新制造旧体系输入** 的说明文档残留。

## 根因判断

综合代码与产物后，可以把“为什么看起来漏了”归纳为四个根因：

| 根因 | 说明 |
| --- | --- |
| 只做了“新增新体系”，没有做“删除旧体系” | 新目录、新 ID、新展示层已建立，但旧产物未批量清理 |
| 同步脚本缺少过期产物清理步骤 | `registry/specs` 与 `registry/generated` 目录会永久累积历史文件 |
| 运行链路仍保留兼容别名 | `main` 与 `control_center` 的 alias 仍在刷新与展示层存在 |
| 文档与安装入口未同步切换 | 新部署仍可能被旧说明重新带回旧命名 |

## 按“无兼容全量重构”标准，必须继续修改的文件

### P0：必须立即处理，否则不算完成重构

| 文件 | 必须动作 |
| --- | --- |
| `scripts/sync_agent_config.py` | 增加 obsolete registry artifact 清理；仅保留现代 agent_id 产物；删除 `legacyTargets` 保留逻辑；确保部署说明与注释不再写“当前阶段无兼容”这种半保留表述，而是直接执行无兼容策略 |
| `registry/specs/*` | 删除所有旧 ID 规格文件，只保留现代 ID |
| `registry/generated/*` | 删除所有旧 ID 生成 SOUL，只保留现代 ID |
| `scripts/refresh_live_data.py` | 删除 `CONTROL_CENTER_ALIAS={'control_center','main'}` 兼容；统一仅认 `control_center` |
| `dashboard/dashboard.html` | 删除 `main` 特判、`main` 标签映射与相关主入口兼容语义 |
| `docs/getting-started.md` | 全部替换旧 ID 示例，确保新部署不会再创建 `taizi` / `zhongshu` 等旧 agent |
| `install.ps1` | 将默认主入口目录从 `agents/main/agent` 切为 `agents/control_center/agent` 或现代自动发现逻辑 |

### P1：建议本轮一并收口，否则仓库仍有误导性

| 文件 | 建议动作 |
| --- | --- |
| `dashboard/server.py` | 清理“兼容旧逻辑”“兼容旧状态编码”等注释与必要性已不存在的历史桥接逻辑 |
| `docs/project-progress-log.md` | 删除“保留 workspace-main / agents/main 兼容链路不影响部署”的历史判断，改为说明该兼容已被移除 |
| `README_modern_cn_cleanup_20260407.md` | 明确标注这是历史归档，不代表现状；避免误导后续维护者以为兼容层仍可接受 |
| 其他文档 | 全仓继续扫 `main`、`taizi`、`zhongshu` 等旧 ID 与“兼容旧”表述 |

## 建议的真正收口顺序

如果按你一开始的要求——**完全重构，不考虑历史兼容**——正确的落地顺序应该是：

| 顺序 | 动作 |
| --- | --- |
| 1 | 锁定现代 agent_id 白名单 |
| 2 | 修改同步脚本：只接受现代 ID，且同步后清理旧 Registry 产物 |
| 3 | 删除运行时刷新层中的 `main` / 旧别名兼容 |
| 4 | 删除前端中对 `main` 的特殊处理与旧标签映射 |
| 5 | 改安装脚本与文档，阻止新部署重新生成旧输入 |
| 6 | 重新跑一次 sync → refresh，验证 `agent_config.json`、`live_status.json`、`registry/specs`、`registry/generated` 全部只剩现代 ID |

## 直接结论

因此，用户这次判断是对的：**这不是你要求变了，而是之前的重构确实漏了最后一段“删旧体系、断兼容链、清历史产物”的收口工作。**

严格按照你原始要求执行的话，后续动作不应该再是“继续兼容”，而应该是：

> **把旧 agent_id、旧 SOUL 产物、旧入口目录、旧别名映射从代码、产物、部署说明里一次性移除。**

完成这一步之后，仓库才算真正达到“无兼容的全量命名体系重构”。
