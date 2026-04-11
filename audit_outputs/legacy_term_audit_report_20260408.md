# 旧术语残留全仓排查报告

## 摘要

本轮继续对仓库中与旧**历史化叙事**以及 **official / memorial / agentorchestrator** 这一组历史内部命名相关的残留进行了复核。结果表明，当前残留已不主要集中在对外首屏文案，而是分布在**统计数据主链路、前端全局状态、静态看板实现、脚本初始化、后端接口字段、截图资产名和安装文档**等多个层面。其中，最关键的问题并不是零散的中文旧称，而是 `officials`、`memorials`、`tasks` 这一组历史内部键名仍然横跨前后端和脚本链路持续存在，已经构成下一轮命名体系重构的主阻塞点。[1] [2] [3] [4] [5]

从影响面看，**统计生产端、接口暴露端与前端消费端仍共用一套旧字段契约**。例如，统计脚本仍输出 `officials`、`top_official` 与 `participated_tasks`，前端 API 类型仍定义 `OfficialInfo` 与 `OfficialsData`，而前端状态与组件又继续围绕 `officialsData`、`selectedOfficial`、`loadOfficials`、`OfficialPanel`、`MemorialPanel` 等命名展开。[2] [3] [4] [5] 这意味着如果下一步要按“几乎完全重构、不考虑历史兼容”的要求推进，就不适合继续零散修补，而应先建立新的**单一权威映射层**，再进行一轮主链路同步替换。[3] [4] [5]

## 一、核心结论

本次排查确认，仓库中的旧术语残留可以分为四个层级。第一层是**运行主链路残留**，即会直接影响统计文件、接口字段、全局状态、组件装配和前端渲染的数据契约残留；第二层是**静态看板与构建产物残留**，即即便 React 源码已开始现代化，旧的 `dashboard/dashboard.html` 与已生成的静态构建仍可继续把旧键名暴露出来；第三层是**脚本与安装链路残留**，这些内容虽不一定总被最终用户看到，但会持续固化旧文件名、旧接口名与旧初始化习惯；第四层是**文档与截图资产残留**，它们会在后续维护和二次传播中不断把历史命名重新带回项目中。[1] [2] [3] [4] [5] [6]

下表概括了当前最需要处理的残留主轴。

| 主轴 | 当前残留 | 风险判断 | 建议处理方式 |
| --- | --- | --- | --- |
| Agent 总览链路 | `officials-stats`、`officials`、`top_official`、`OfficialInfo`、`OfficialPanel` | 高 | 以新统计接口和新类型名为中心整体迁移 |
| 归档链路 | `memorials`、`MemorialPanel`、`exportMemorial`、截图 `08-memorials.png` | 高 | 统一改为 `archives` / `Archive*` 体系 |
| 任务链路 | `tasks`、`AgentOrchestratorBoard`、`isAgentOrchestrator`、`submitFreeTask`、`imperial-agentorchestrator` | 高 | 统一改为更直接的 task / work item 语义 |
| 后端字段 | `official` 字段、`/api/court-discuss/officials`、`officials list required` | 高 | 与前端字段和讨论接口一起改名 |
| 脚本与初始化 | `sync_officials_stats.py`、`officials_stats.json`、`officials.json` | 高 | 作为主链路迁移的一部分同步重命名 |
| 文档与截图 | `06-official-overview.png`、`08-memorials.png`、文档命令旧名 | 中 | 主链路稳定后统一更新 |
| 中文历史注释 | `旧协作主题色注释`、`旧协作命名 · Python 依赖` 等 | 中 | 可在主链路完成后集中收口 |

## 二、前端源码残留清单

前端源码中的问题已经从“显示层旧称”演变为“结构层旧键”。在 `App.tsx` 中，顶层面板仍通过 `OfficialPanel`、`MemorialPanel`、`officials`、`memorials`、`tasks` 这一组键进行装配和徽标统计；在 `store.ts` 中，`TabKey`、全局状态字段和加载函数则进一步固化了 `officialsData`、`selectedOfficial`、`loadOfficials` 等命名；而 `api.ts` 又继续把这种旧契约扩展为 `OfficialInfo`、`OfficialsData` 与 `/api/officials-stats`。[3] [4] [5]

这意味着前端当前并非只有若干“旧名字没改完”的问题，而是**旧术语已经嵌入了路由键、状态键、接口类型和组件文件名**。如果只修改用户可见标题而不重构这些键名，那么新的现代命名层将继续建立在旧结构之上，后续任何扩展都会反复受限。[3] [4] [5]

| 文件 | 已确认残留 | 影响面 | 建议新命名方向 |
| --- | --- | --- | --- |
| `agentorchestrator/frontend/src/App.tsx` | `OfficialPanel`、`MemorialPanel`、`officials`、`memorials`、`tasks` | 顶层面板路由与徽标计数 | `AgentOverviewPanel`、`ArchivePanel`、`agents`、`archives`、`tasks` |
| `agentorchestrator/frontend/src/store.ts` | `OfficialsData`、`officialsData`、`selectedOfficial`、`loadOfficials`、`isAgentOrchestrator` | 全局状态、轮询与标签定义 | `AgentOverviewData`、`agentsData`、`selectedAgent`、`loadAgentsOverview`、`isTaskRecord` |
| `agentorchestrator/frontend/src/api.ts` | `officialsStats`、`OfficialInfo`、`OfficialsData`、`top_official`、`participated_tasks` | 前后端数据契约 | `agentsOverview`、`AgentOverviewItem`、`AgentOverviewData`、`top_agent`、`participated_tasks` |
| `agentorchestrator/frontend/src/components/OfficialPanel.tsx` | `OfficialPanel`、`officialsData`、`selectedOfficial` | Agent 总览主面板 | `AgentOverviewPanel`、`agentsData`、`selectedAgent` |
| `agentorchestrator/frontend/src/components/MemorialPanel.tsx` | `MemorialPanel`、`MemorialDetailModal`、`exportMemorial`、变量 `mems` | 结果归档主面板 | `ArchivePanel`、`ArchiveDetailModal`、`exportArchive`、`archives` |
| `agentorchestrator/frontend/src/index.css` | `Officials`、`Memorials` 注释与 `off-*`、`mem-*`、`od-agentorchestrator-list` | 样式命名体系 | 按新组件名统一更换类族 |
| `agentorchestrator/frontend/tailwind.config.js` | `旧协作主题色注释` | 开发配置注释 | 改为现代协作主题说明 |

## 三、静态看板与构建产物残留清单

当前最大的盲区之一是 `dashboard/dashboard.html`。该文件仍然保留着一整套与 React 版并行的旧看板实现，其中不仅包含 `data-tab="officials"`、`data-tab="memorials"`、`panel-officials`、`panel-memorials` 等结构键，还保留了 `officialsData`、`loadOfficials()`、`renderOfficials()`、`renderMemorials()`、`openMemorial()`、`submitFreeTask()`、`imperial-agentorchestrator` 等大量旧语义函数和变量。[6]

这说明即使后续只修改 React 源码，如果没有同步处理这一静态实现和其构建产物，旧命名仍会继续存在于可发布页面中。同时，`dashboard/dist/assets/*` 中已编译的脚本也仍可见 `officials`、`memorials`、`tasks` 以及更早期的官制 ID 痕迹，因此**任何源码级重命名都必须以重新构建和覆盖发布产物收尾**。[6]

| 文件 | 已确认残留 | 风险等级 | 说明 |
| --- | --- | --- | --- |
| `dashboard/dashboard.html` | `officials`、`memorials`、`loadOfficials`、`renderMemorials`、`submitFreeTask`、`imperial-agentorchestrator` | 高 | 仍是高密度旧术语聚集区 |
| `dashboard/dist/assets/*` | 编译后仍包含 `officials`、`memorials`、`tasks` 等 | 高 | 若不重建，会持续对外暴露旧键名 |
| `docs/screenshots/README.md` | `06-official-overview.png`、`08-memorials.png` | 中 | 静态资产名会反向影响文档和宣传材料 |

## 四、后端接口与数据模型残留清单

后端侧目前的残留主要集中在**统计接口、协同讨论接口与任务模型字段**。`dashboard/server.py` 仍通过 `/api/officials-stats` 暴露总览数据，并在协同讨论接口中使用 `/api/court-discuss/officials`、`officials list required` 以及“至少选择2位官员”这样的校验提示。同时，任务创建函数 `handle_create_task()` 仍保留 `official` 参数，且调度触发名仍使用 `imperial-agentorchestrator`。[2] [6]

更关键的是，`agentorchestrator/backend/app/models/task.py` 仍把 `official` 作为任务模型字段保存并输出。这意味着如果下一轮真的执行“完全重构且不保留历史兼容”，那么仅改 API 层远远不够，**数据库模型、序列化输出、任务创建链路与前端消费字段必须一起迁移**。[2] [7]

| 文件 | 残留字段或接口 | 影响面 | 建议替换 |
| --- | --- | --- | --- |
| `dashboard/server.py` | `/api/officials-stats` | Agent 总览接口 | `/api/agents-overview` 或等价直接名称 |
| `dashboard/server.py` | `official` 参数 | 任务创建载荷 | `owner`、`ownerRole` 或更明确责任字段 |
| `dashboard/server.py` | `/api/court-discuss/officials`、`officials list required` | 协同讨论接口 | `agentIds`、`agents list required` |
| `dashboard/server.py` | `trigger='imperial-agentorchestrator'` | 内部触发语义 | 更中性的 `task-created` / `control-intake` |
| `agentorchestrator/backend/app/models/task.py` | `official` 列 | 任务数据模型 | 与新责任字段一起整体迁移 |
| `agentorchestrator/backend/app/api/admin.py` | `officials_stats` 文件检查 | 诊断与迁移检查 | 与新统计文件名同步更新 |

## 五、脚本、启动链路与文档残留清单

脚本层的关键问题在于，统计同步脚本 `scripts/sync_officials_stats.py` 仍然是 Agent 总览数据的**权威生产端**，但它的文件名、默认常量、输出顶层键和若干字段全部沿用历史命名，包括 `DEFAULT_OFFICIALS`、`officials`、`top_official`、`participated_tasks` 与输出文件 `officials_stats.json`。[2] 只要这一生产端不改，前端和接口层的现代命名就无法真正闭环。

与此同时，`start.sh`、`agentorchestrator.sh`、`install.ps1` 和安装文档又继续围绕 `officials.json`、`officials_stats.json` 与 `sync_officials_stats.py` 组织初始化流程，这会让旧命名继续以“基础设施习惯”的形式被固化下来。[8] [9] [10] [11] 文档侧则通过截图文件名、命令示例和历史说明不断复写这些旧术语，典型例子包括 `06-official-overview.png`、`08-memorials.png`、`import-official-hub` 和多处 `sync_officials_stats.py` 命令引用。[10] [11] [12] [13] [14]

| 类别 | 文件 | 已确认残留 | 优先级 |
| --- | --- | --- | --- |
| 统计脚本 | `scripts/sync_officials_stats.py` | 文件名、`DEFAULT_OFFICIALS`、`officials`、`top_official`、`participated_tasks` | P0 |
| 启动脚本 | `start.sh`、`agentorchestrator.sh` | `officials.json`、`officials_stats.json` 初始化 | P1 |
| 安装脚本 | `install.ps1` | `official` 字段、`sync_officials_stats.py` 调用 | P1 |
| 依赖说明 | `requirements.txt` | `旧协作命名 · Python 依赖` 注释 | P2 |
| 角色文档 | `agents/control_center/SOUL.md` | `kanban_update.py ... <official>` 示例 | P2 |
| 安装文档 | `WINDOWS_INSTALL_CN.md` | `officials_stats.json`、`/api/officials-stats` | P1 |
| 宣传文档 | `docs/wechat-article.md` | `06-official-overview.png`、`08-memorials.png`、`sync_officials_stats.py` | P2 |
| 技能文档 | `docs/remote-skills-guide.md`、`docs/remote-skills-quickstart.md` | `import-official-hub` | P2 |

## 六、建议采用的统一映射方案

结合当前残留结构，下一步最适合采用的不是局部修词，而是建立一份新的**唯一权威映射表**。这份映射表应同时服务于前端展示、API 类型、统计脚本和任务流转说明，至少包含以下字段：现代英文 ID、中文标签、英文标签、中文职责、英文职责、层级/分组、颜色、emoji、兼容别名集合以及是否允许外部展示。

在命名方向上，建议直接放弃 `officials`、`memorials`、`tasks` 这组三个历史包袱最重的内部键，替换为更加直接、低歧义的现代词汇。下面给出一份建议映射，用于下一轮集中重构的起点。[2] [3] [4] [5] [6]

| 旧内部名 | 建议新内部名 | 适用层 | 说明 |
| --- | --- | --- | --- |
| `officials` | `agents` | 数据集合、标签页、接口路径 | “协作节点/Agent”已是现行展示语义 |
| `OfficialInfo` | `AgentOverviewItem` | 前端类型 | 明确这是总览统计项而非泛化 agent 基类 |
| `OfficialsData` | `AgentOverviewData` | 前端类型 | 与页面用途一致 |
| `officials-stats` | `agents-overview` | API 路径 | 更贴近页面用途 |
| `top_official` | `top_agent` | 顶层统计字段 | 直观且无旧官制色彩 |
| `selectedOfficial` | `selectedAgent` | 前端状态 | 与现有展示语义一致 |
| `loadOfficials` | `loadAgentsOverview` | 前端动作 | 明确载入的是 overview 数据 |
| `memorials` | `archives` | 标签页、面板 ID、组件名 | 已与“结果归档”展示语义一致 |
| `MemorialPanel` | `ArchivePanel` | 组件名 | 直接对应当前页面功能 |
| `exportMemorial` | `exportArchive` | 组件函数 | 减少历史比喻语义 |
| `tasks` | `tasks` | 标签页与任务集合 | 用现代任务语义替代历史诏令语义 |
| `AgentOrchestratorBoard` | `TaskBoard` | 组件名 | 简化认知成本 |
| `isAgentOrchestrator` | `isTaskRecord` | 工具函数 | 去除历史语义负担 |
| `participated_tasks` | `participated_tasks` | 统计字段 | 与真实数据内容一致 |
| `official` | `owner` / `ownerRole` | 任务字段 | 需结合数据模型一起定稿 |
| `imperial-agentorchestrator` | `task-created` / `control-intake` | 内部触发名 | 用事件语义替代历史叙事 |

## 七、推荐的集中替换顺序

为了避免出现“接口已改、前端未改”或“源码已改、构建未重发”的中间失配状态，建议按以下顺序推进。首先，确定新的权威映射和新的文件/字段命名；其次，优先改造统计脚本、后端接口与前端 API 类型；然后再切换全局状态和页面组件；之后统一处理静态看板与构建产物；最后再清理安装脚本、截图资产和说明文档。[2] [3] [4] [5] [6] [8] [9] [10] [11]

| 批次 | 文件范围 | 目标 | 优先级 |
| --- | --- | --- | --- |
| 批次 A | `scripts/sync_officials_stats.py`、`dashboard/server.py`、`agentorchestrator/frontend/src/api.ts` | 先打通新数据契约与接口名 | P0 |
| 批次 B | `agentorchestrator/frontend/src/store.ts`、`App.tsx`、`OfficialPanel.tsx`、`MemorialPanel.tsx`、相关组件 | 切换前端全局状态、标签键与组件命名 | P0 |
| 批次 C | `dashboard/dashboard.html`、重新生成 `dashboard/dist` | 清理并行静态实现与发布产物 | P1 |
| 批次 D | `start.sh`、`agentorchestrator.sh`、`install.ps1`、`WINDOWS_INSTALL_CN.md` | 统一初始化链路与部署说明 | P1 |
| 批次 E | `docs/`、截图文件名、README 系列、SOUL 示例 | 收口传播链路中的旧术语 | P2 |

## 八、项目内留痕

本轮排查已在仓库内新增两份留痕文件，便于后续继续执行集中替换工作。其一是待办清单 `TODO_legacy_term_audit.md`，用于逐项核销下一轮改名任务；其二是本报告本身，用于作为统一替换的输入依据。若下一步进入实际重构阶段，建议继续在同一目录下追加“映射表定稿”“主链路替换日志”“构建回归结果”三类文档，以防再次出现“误判已清零”的情况。

## References

[1]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/components/OfficialPanel.tsx "agentorchestrator/frontend/src/components/OfficialPanel.tsx"
[2]: file:///home/ubuntu/multi-agent-orchestrator_public/scripts/sync_officials_stats.py "scripts/sync_officials_stats.py"
[3]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/App.tsx "agentorchestrator/frontend/src/App.tsx"
[4]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/api.ts "agentorchestrator/frontend/src/api.ts"
[5]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/store.ts "agentorchestrator/frontend/src/store.ts"
[6]: file:///home/ubuntu/multi-agent-orchestrator_public/dashboard/dashboard.html "dashboard/dashboard.html"
[7]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/models/task.py "agentorchestrator/backend/app/models/task.py"
[8]: file:///home/ubuntu/multi-agent-orchestrator_public/start.sh "start.sh"
[9]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator.sh "agentorchestrator.sh"
[10]: file:///home/ubuntu/multi-agent-orchestrator_public/install.ps1 "install.ps1"
[11]: file:///home/ubuntu/multi-agent-orchestrator_public/WINDOWS_INSTALL_CN.md "WINDOWS_INSTALL_CN.md"
[12]: file:///home/ubuntu/multi-agent-orchestrator_public/docs/wechat-article.md "docs/wechat-article.md"
[13]: file:///home/ubuntu/multi-agent-orchestrator_public/docs/screenshots/README.md "docs/screenshots/README.md"
[14]: file:///home/ubuntu/multi-agent-orchestrator_public/docs/remote-skills-guide.md "docs/remote-skills-guide.md"
