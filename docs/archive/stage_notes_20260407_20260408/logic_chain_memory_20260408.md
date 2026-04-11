# multi-agent-orchestrator 项目逻辑链与运行方式记忆稿

## 目的

这份文档用于在上下文波动时保留本项目当前已经确认的**逻辑链、运行方式、SOUL 角色分工、看板更新机制与后续核查重点**，避免再次出现“知道看过很多文件，但链路断掉”的情况。

## 当前定位

该项目不是一套完全脱离外部运行时的独立 Agent 引擎，而是一个**围绕 OpenClaw 运行环境进行组织、治理、同步、看板化与自动化托管增强的配套项目**。因此，项目中的目录结构、SOUL、Registry、同步脚本、数据聚合脚本与前端面板，本质上都服务于同一件事：

> 把多 Agent 在 OpenClaw 侧的角色定义、运行配置、任务流转、状态观测与治理动作，统一到一个可维护、可同步、可看板查看的项目侧中枢里。

## 已确认的总逻辑链

目前已经能稳定串起来的主链路如下：

`描述文档 / 已写好的 SOUL / Agent Registry 规范`
→ `scripts/sync_agent_config.py`
→ `registry/specs/*.json`
→ `registry/generated/*.SOUL.md`
→ `agents/*/SOUL.md` 与 workspace 中的正式部署文件
→ `data/agent_config.json`
→ `scripts/refresh_live_data.py`
→ `data/live_status.json`
→ `dashboard/server.py` API
→ `agentorchestrator/frontend/src/api.ts`
→ `agentorchestrator/frontend/src/store.ts`
→ 各类前端面板（任务看板、自动化中心、运行监控等）

这条链说明：**SOUL 联通、运行态配置、看板数据和前端展示不是孤立模块，而是前后连续的配置—部署—聚合—消费链。**

## 当前已确认的运行方式

项目运行不是单纯“前端请求后端数据库”这种标准 Web App 模式，而更接近**文件驱动 + 脚本聚合 + API 封装 + 前端轮询消费**。

### 运行方式拆解

| 层级 | 作用 | 当前理解 |
| --- | --- | --- |
| SOUL / 描述层 | 定义角色职责、流程顺序、操作规则 | 主要存在于 `agents/*/SOUL.md`、`registry/generated/*.SOUL.md`、相关说明文档 |
| Registry 层 | 定义结构化 Agent 规格、路由、运行策略与生成依据 | 主要存在于 `registry/specs/*.json` 与 `docs/agent_registry_spec.md` |
| 同步层 | 把 Registry/agents 产物同步成可运行配置与部署文件 | 由 `scripts/sync_agent_config.py` 负责 |
| 运行态配置层 | 为后续看板和刷新脚本提供统一读取入口 | 主要是 `data/agent_config.json` |
| 状态聚合层 | 汇总任务、心跳、调度、自动化状态，产出 live status | 由 `scripts/refresh_live_data.py` 与相关 watcher 桥接完成 |
| API 层 | 把 JSON / 运行态信息包装成前端可消费接口 | 主要由 `dashboard/server.py` 提供 |
| 前端状态层 | 轮询拉取、缓存全局状态、分发到不同面板 | 主要由 `agentorchestrator/frontend/src/store.ts` 完成 |
| 展示层 | 各面板按共享状态做视图与动作入口 | 如 `AgentOrchestratorBoard.tsx`、`AutomationPanel.tsx` 等 |

## 已确认的角色主流程（来自 SOUL）

### 1. 总控中心 control_center

当前 SOUL 明确给出了总控中心的流程职责：

1. 接收来自飞书的所有用户消息。
2. 判断消息是闲聊/问答，还是正式任务。
3. 简单消息由总控直接回复，不创建任务。
4. 正式任务由总控概括后创建 JJC 任务，并转交规划中心。
5. 调度中心回传最终结果后，总控回到原对话中向用户交付。

这说明**总控中心是用户入口与最终回复出口**，而不是任务执行者。它负责建立任务、转交规划、同步进展、完成最终回传。

### 2. 规划中心 plan_center

当前 SOUL 明确给出了规划中心的强约束顺序：

1. 接收任务。
2. 起草方案。
3. 调用评审中心审议。
4. 审议通过后必须立即调用调度中心。
5. 只有在调度中心返回结果后，规划中心才能完成回传。

其中最关键的一条是：

> 规划中心**不能在评审通过后停下**，必须继续推进到调度中心执行完成。

这说明项目希望通过 SOUL 把“半截停住”的问题在角色提示层直接压住。

## 看板更新方式的当前理解

从已读 SOUL 与前端结构看，看板更新是项目中的主治理机制之一。

### 看板更新并非前端直接改状态

SOUL 中多次明确：

> 所有看板操作必须通过 `python3 scripts/kanban_update.py` 完成，不能手写 JSON。

这意味着**任务状态的真实来源仍然是 CLI / 脚本落盘机制**，而不是前端页面本身。

### 当前已确认的看板命令职责

| 命令 | 作用 |
| --- | --- |
| `create` | 创建任务 |
| `state` | 更新状态 |
| `flow` | 记录流转 |
| `done` | 标记任务完成并写入结果摘要 |
| `progress` | 更新当前动态与计划清单，不改变状态 |
| `todo` | 记录子任务与产出详情 |

### 进展更新是强要求

control_center 与 plan_center 的 SOUL 都把 `progress` 上报列为高优先级动作。这说明：

1. 项目并不满足于“最终有结果”；
2. 看板被设计成**过程可视化**而非单纯结果归档页；
3. 如果 agent 不按要求调用 `progress`，即使任务在做，面板也会显得像断更。

## 前端面板更新方式的当前理解

从 `api.ts` 与 `store.ts` 已能确认以下事实：

1. 前端主要通过 HTTP 轮询拉取数据，而不是 WebSocket。
2. `liveStatus` 是多个面板共享的重要全局数据源。
3. `Task` 数据结构中已包含 `flow_log`、`todos`、`activity`、`archived`、`sourceMeta` 等字段，说明面板展示不是只看状态枚举，而是消费一整套任务画像。
4. 自动化中心并不直接维护独立自动化数据库视图，而是从 `liveStatus.tasks` 中二次筛选、计算汇总、提炼自动化日志。

换言之，**面板更新的关键不是 UI 组件本身，而是 live status 是否被稳定刷新，以及刷新后的字段是否足够完整。**

## AutomationPanel 当前揭示出的事实

从自动化中心组件可以确认：

1. 自动化中心页面的数据全部建立在 `liveStatus.tasks` 上。
2. 它通过 `getTaskScheduler()` 读取每个任务的 `_scheduler` 信息。
3. 它用 `getSchedulerSummary()` 把调度状态转成 UI 文案，如“自动托管正常”“自动重试中”“升级协调”“已回滚”。
4. “立即巡检”按钮实际调用的是 `/api/scheduler-scan`，然后再执行 `loadAll()` 重新加载全局状态。

因此，这条子链路可以暂时记成：

`任务数据 + _scheduler`
→ `api/live-status`
→ `store.liveStatus`
→ `AutomationPanel`
→ `schedulerScan/loadAll` 触发新一轮刷新

## 当前关于归档机制的稳定记忆

这一部分已经多轮核对，可作为暂定结论保留：

1. 当前仓库中**没有确认到“任务完成后静置多久自动归档”的明确实现**。
2. 已发现的自动化巡检更偏向于停滞任务治理、重试、升级、回滚，而不是“完成即自动归档”。
3. 当前更符合实现现状的产品口径应是：
   - 归档主要通过看板显式操作或批量归档完成；
   - 任务完成后，总控先完成结果回传；
   - 归档与最终检查属于交付链路的一部分，而不是默认静置后自动触发。

## 当前最值得继续核对的断点

下面这些地方，是后续继续读文件或改文件时必须重点盯住的：

| 链路位置 | 已知情况 | 仍需确认的问题 |
| --- | --- | --- |
| `agents/*/SOUL.md` 与 `registry/generated/*.SOUL.md` | 两套 SOUL 资产并存 | 哪些是源资产，哪些是生成产物，是否存在漂移 |
| `registry/specs/*.json` 与 `data/agent_config.json` | 理论上应被同步脚本打通 | 字段是否完整进入运行态配置 |
| `refresh_live_data.py` | 负责 live status 聚合 | 它具体从哪些文件读，哪些字段会丢失 |
| `refresh_watcher.py` | 作为刷新桥接 | 是否所有关键写入都能触发刷新 |
| `dashboard/server.py` | API 聚合层 | 是否存在接口返回字段与前端预期不一致 |
| `store.ts` | 全局状态分发层 | `loadAll()` 的触发点是否覆盖关键动作 |
| `AgentOrchestratorBoard.tsx` 等组件 | 具体展示与操作入口 | 是否存在界面文案和真实行为不一致 |

## 接下来的工作原则

后面继续推进时，必须遵守以下原则：

1. 不再把项目当成抽象概念讨论，而是始终围绕**配置产物 → 刷新脚本 → API → store → 面板**这条链路检查。
2. 不只看描述文件，要把**已写好的 SOUL** 当成系统行为定义的一部分。
3. 每发现一条稳定链路或断点，都及时写回这类留痕文档，避免再次丢失上下文。
4. 后续若要修改文件，应优先改那些能让整条链更清晰的文件：说明文档、链路图、检查单、关键界面文案与必要的同步/刷新断点。

## 当前记忆结论

到目前为止，可以先记住这一句话：

> 这个项目的核心不是“再做一个 agent 产品”，而是把 OpenClaw 场景下的多 Agent 角色、SOUL、Registry、运行态配置、任务看板与自动化治理，收束成一条可同步、可观测、可交付的项目侧逻辑链。

## 新补充：Registry → SOUL → OpenClaw workspace → 运行态配置的确定链路

基于 `docs/agent_registry_spec.md` 与 `scripts/sync_agent_config.py` 的进一步核对，现在可以把项目的**配置联通主干**记得更具体。

### 1. 配置来源不是单一文件，而是“三层合并”

当前同步脚本并不是只读一个配置源，而是按以下顺序拼出可运行 Agent 列表：

| 层级 | 主要来源 | 作用 |
| --- | --- | --- |
| 运行时来源 | `~/.openclaw/openclaw.json` | 优先读取 OpenClaw 当前正在使用的 agent 列表、model、workspace、allowAgents 等运行信息 |
| 项目回退来源 | `agents.json` | 当 OpenClaw 配置缺失或无法读取时提供兜底 agent 列表 |
| 项目资产来源 | `agents/*/SOUL.md`、`registry/specs/*.json` | 提供项目内已写好的 SOUL、已存在的 Registry spec、展示名、职责、部署策略与历史元数据 |

这说明项目运行方式是：**以 OpenClaw 运行为主，以项目侧资产做增强、补全与规范化。**

### 2. Agent 候选集合由项目目录与运行态共同决定

同步脚本不会只同步 OpenClaw 当前声明过的 agent，而是把以下来源并起来：默认中心/专家列表、`agents/` 目录中已存在 `SOUL.md` 的角色，以及运行时配置里出现的 agent。随后脚本用这些候选 ID 去构造最终的 `data/agent_config.json`。

因此，项目里的 `agents/*/SOUL.md` 不只是文档资产，它本身也会**反向影响运行态候选集合**。

### 3. Registry spec 是运行态增强层，不只是展示层

每个 agent 在进入最终 payload 前，都会经过以下处理：

`infer_agent_meta()`
→ `merge_allow_agents()`
→ `merge_runtime_policy()`
→ `merge_registry_meta()`
→ `build_registry_spec()`

其中会补齐下列关键字段：

| 字段块 | 实际作用 |
| --- | --- |
| `display` | 给前端与文档统一展示名、角色名、分组与摘要 |
| `identity` | 定义职责边界、上下游、必须升级范围 |
| `routing` | 定义允许转交目标与优先级类型 |
| `runtimePolicy` | 定义串行执行、实时等级、心跳、过期阈值与长任务边界 |
| `deployment` | 定义项目内 SOUL 路径、workspace 目标路径、sidecar 与脚本同步策略 |
| `visibility` | 定义是否在 dashboard / registry 中可见 |
| `metadata` | 记录 model、workspace、更新时间与来源 |

这说明 **Registry 不是单独给页面看的“标签层”，而是运行态解释层、部署层和可视化层共用的中间规范。**

### 4. `data/agent_config.json` 是前后续脚本共同消费的运行态总入口

`main()` 最终会把所有 agent 写入 `data/agent_config.json`，其中顶层至少包含：

| 顶层字段 | 作用 |
| --- | --- |
| `productName` | 当前产品叙事名称 |
| `defaultModel` / `knownModels` | 提供模型下拉、显示与兼容信息 |
| `dispatchChannel` | 保留原有派发通道配置 |
| `serialExecutionModel` | 明确单 Agent 单任务 |
| `systemRepairScope` | 明确系统修复边界 |
| `agents[]` | 每个 agent 的完整运行态聚合配置 |

这意味着：后续无论是刷新脚本、面板展示、调度说明还是运行检查，**都应优先把 `data/agent_config.json` 当作项目侧统一运行态真相入口之一**。

### 5. SOUL 的正式部署采用“源文件优先，生成骨架兜底”

当前 SOUL 部署逻辑不是简单复制，而是：

| 情况 | 部署策略 |
| --- | --- |
| `agents/{agent_id}/SOUL.md` 已包含标准章节 | 原样部署到 `~/.openclaw/workspace-{agent_id}/soul.md` |
| 项目 SOUL 存在但结构不完整 | 用 Registry 生成标准骨架，并把原始手写内容作为“角色专用细则”附录拼接后部署 |
| 项目 SOUL 不存在 | 回退使用 `registry/generated/{agent_id}.SOUL.md` 首次部署 |

同时，workspace 中还会写入 `.registry.json` sidecar。

这条逻辑非常关键，因为它解释了为什么**项目中“已经写好的 SOUL”与“自动生成 SOUL”会并存，而且不是互斥关系，而是部署链中的源资产 + 兜底资产关系。**

### 6. scripts 同步到 workspace 的目的，是让 OpenClaw 侧执行时仍然落回项目主数据目录

`sync_scripts_to_workspaces()` 当前采用**符号链接**而不是复制脚本。这样 workspace 里的脚本在运行时，`__file__` 仍然会解析到项目主目录的 `scripts/`，从而保证 `kanban_update.py`、刷新脚本等相对路径常量仍指向项目主 `data/` 目录。

这解释了一个很容易忘掉的运行特征：

> OpenClaw 在各 workspace 中执行脚本，但数据真相并不分散在各 workspace，而是尽量回收到项目主目录下统一维护。

### 7. 当前可稳定记住的配置联通链

现在可以把这段链路固定记成：

`~/.openclaw/openclaw.json / agents.json / agents/*/SOUL.md / 既有 registry spec`
→ `scripts/sync_agent_config.py`
→ `registry/specs/*.json`
→ `registry/generated/*.SOUL.md`
→ `agents/*/SOUL.md`（源资产）
→ `~/.openclaw/workspace-*/soul.md` 与 `.registry.json`
→ `workspace-*/scripts/*`（符号链接回项目 scripts）
→ `data/agent_config.json`
→ 后续刷新脚本与 API / 前端消费链

### 8. 当前仍需继续核对的具体断点

| 断点 | 当前判断 |
| --- | --- |
| `registry/specs/*.json` 中哪些字段真正进入 `live_status.json` | 尚未完全确认，需要继续看刷新链路 |
| 各 agent 手写 SOUL 与生成骨架拼接后在 workspace 中的最终效果 | 仍需抽查或看 `soul_validation_report.json` |
| `allowAgents` 与前端可见路由/派发逻辑是否完全一致 | 仍需继续核对 dashboard API 与面板消费层 |
| 调度中心、自动化中心是否完整消费 `runtimePolicy` / `_scheduler` | 仍需继续核对刷新脚本和前端组件 |
