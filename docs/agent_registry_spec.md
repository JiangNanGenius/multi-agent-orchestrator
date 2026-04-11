# 多Agent智作中枢 Agent Registry 规范

## 1. 目标

本文档定义 **多Agent智作中枢** 的 `Agent Registry` 规范，用于统一描述 Agent 的显示名称、职责边界、运行策略、SOUL 生成参数与自动部署行为。该规范的设计目标不是替代现有 `SOUL.md`，而是为 **整份 SOUL 的自动生成、自动部署与运行态注册** 提供一份稳定、清晰、机器可读且便于 Agent 理解的中间规范。

本规范遵循三项前提。第一，**每个角色仍然保留一整份完整 SOUL**，而不是拆成碎片化提示词。第二，**总控中心默认保持最高实时性**，仅在进入系统性修复模式时允许长时间占用执行链路。第三，运行时必须兼容 **OpenClaw 单 Agent 串行执行** 的现实约束，因此系统扩容应优先通过新增多个 `XX 专家` 实现，而不是假设单 Agent 并发执行。[1] [2]

| 设计目标 | 规范要求 |
|---|---|
| Agent 能看懂 | 字段命名稳定，中文语义直接，不依赖隐喻 |
| SOUL 能自动生成 | 规范能完整描述角色身份、输入输出、流程动作与语气要求 |
| Agent 能自动部署 | 注册后可自动落盘规范、生成 SOUL、部署到 workspace、同步项目侧运行产物 |
| 保持现有引擎兼容 | 运行时 `agent_id`、工作区路径、状态流转与现有取数逻辑尽量不破坏 |
| openclaw.json 处理方式 | 仅作为只读参考与建议配置来源，不作为本次改造的直接修改目标 |

## 2. 规范对象与落地范围

`Agent Registry` 不是单纯的展示层配置，而是连接 **配置同步脚本、看板展示、SOUL 生成、运行时部署与刷新策略** 的统一基线。所有新 Agent、现有 Agent 的现代中文显示信息，以及总控中心和各类专家的运行约束，都应由该规范统一输出。

本阶段规范覆盖以下对象。

| 对象 | 说明 |
|---|---|
| 总控中心 | 系统统一入口，负责受理、首轮处理、快速分流、异常升级与系统性修复触发 |
| 规划中心 | 负责任务拆解、方案起草、流转编排 |
| 评审中心 | 负责质量核验、约束审查、回退把关 |
| 调度中心 | 负责任务派发、状态汇总、升级协调 |
| 专业执行组 | 执行层容器，承载 N 个 `XX 专家` |
| XX 专家 | 专项能力执行单元，例如代码专家、数据专家、部署专家等 |
| 支撑角色 | 如晨报中心等辅助运行角色 |

## 3. 总体结构

每个 Agent 的注册信息应由一份规范对象表达。该对象面向脚本和 Agent 双重可读，既可序列化为 JSON，也可被自动生成器直接用于产出完整 `SOUL.md`。

| 一级字段 | 类型 | 作用 |
|---|---|---|
| `schemaVersion` | string | 规范版本号 |
| `productName` | string | 产品名，固定为“多Agent智作中枢” |
| `agentId` | string | 运行时唯一 ID，例如 `control_center`、`code_specialist` |
| `display` | object | 用户可见名称、角色名、分组、简述 |
| `identity` | object | 角色定位、职责、边界、协作关系 |
| `routing` | object | 可接任务、可升级流转、可回退目标、优先级 |
| `runtimePolicy` | object | 实时性、串行约束、系统性修复边界、队列策略 |
| `soulGeneration` | object | 整份 SOUL 的生成模式、输入片段、输出目标 |
| `deployment` | object | 自动部署的目标路径、兼容映射与同步动作 |
| `visibility` | object | 看板可见性、标签、统计分组 |
| `metadata` | object | 更新时间、来源、说明、扩展字段 |

## 4. 核心字段定义

### 4.1 display

`display` 用于统一用户可见表达。它与运行时 `agentId` 保持一致的现代命名体系，并决定看板、文档、管理页、注册中心和自动生成 SOUL 中的展示称呼。

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `label` | string | 看板主显示名 | `总控中心` |
| `roleName` | string | 角色名 | `总控专家` |
| `group` | string | 所属分组 | `总控中心` / `专业执行组` |
| `expertCategory` | string | 专家类别，非专家可为空 | `代码专家` |
| `summary` | string | 一句话职责摘要 | `任务受理、首轮处理与异常升级` |
| `icon` | string | UI 图标或 emoji | `🎛️` |

### 4.2 identity

`identity` 描述 Agent 的组织定位、核心职责与能力边界，是生成整份 SOUL 时最重要的语义来源。该部分必须尽量直白，避免抽象口号式表述。

| 字段 | 类型 | 说明 |
|---|---|---|
| `positioning` | string | 角色定位描述 |
| `coreResponsibilities` | string[] | 核心职责清单 |
| `directHandleScope` | string[] | 可直接处理的任务范围 |
| `mustEscalateScope` | string[] | 必须升级转交的任务范围 |
| `systemRepairScope` | string[] | 进入系统性修复模式的任务范围 |
| `upstream` | string[] | 上游协作对象 |
| `downstream` | string[] | 下游协作对象 |
| `handoffRule` | string | 转交流程说明 |
| `tone` | string | 输出语气要求 |

### 4.3 routing

`routing` 用于描述该 Agent 在任务流中的接单与转单规则。由于当前任务引擎的数据获取逻辑基本可复用，本字段应聚焦 **角色边界和任务去向**，而不是重写状态机。

| 字段 | 类型 | 说明 |
|---|---|---|
| `acceptTaskTypes` | string[] | 可接任务类型 |
| `rejectTaskTypes` | string[] | 不应接收的任务类型 |
| `preferredSources` | string[] | 主要来源节点 |
| `allowedTargets` | string[] | 允许转交目标 |
| `fallbackTargets` | string[] | 阻塞或失败时的回退目标 |
| `priorityClass` | string | 优先级类型，如 `realtime`、`standard`、`batch` |

### 4.4 runtimePolicy

`runtimePolicy` 直接服务于刷新链路与调度约束，必须明确表达 **单 Agent 串行** 与 **总控中心最高实时性** 这两条原则。

| 字段 | 类型 | 说明 |
|---|---|---|
| `executionMode` | string | 固定为 `serial` |
| `maxConcurrentTasks` | number | 固定为 `1` |
| `realtimeTier` | string | `highest` / `standard` / `batch` |
| `keepRealtimeByDefault` | boolean | 是否默认保持高实时性 |
| `allowLongRunningExecution` | boolean | 是否允许长时执行 |
| `systemRepairOnlyLongRunning` | boolean | 是否仅系统性修复时允许长时执行 |
| `heartbeatSeconds` | number | 心跳刷新基准秒数 |
| `staleAfterSeconds` | number | 判定过期秒数 |
| `queueStrategy` | string | 如 `single-agent-single-task` |

> 对总控中心而言，`allowLongRunningExecution` 不表示可长期承担常规任务，而是表示 **只有在系统性修复范围内** 才可暂时切入长任务模式。系统性修复仅包括修改 SOUL、修改看板对接、调整系统级协作逻辑、调整系统级接入逻辑等操作；制作或测试 Skill 不属于该范围。[1]

### 4.5 soulGeneration

`soulGeneration` 负责把规范转换为整份 `SOUL.md`。这里的关键不是片段拼装，而是确保每个角色始终产出 **完整、独立、可直接部署** 的 SOUL 文档。

| 字段 | 类型 | 说明 |
|---|---|---|
| `mode` | string | 固定为 `full_document` |
| `autoGenerate` | boolean | 是否允许自动生成 |
| `source` | string | 生成来源，固定为 `agent_registry_spec` |
| `targetFile` | string | 目标文件，固定为 `SOUL.md` |
| `templateVersion` | string | 模板版本号 |
| `mustIncludeSections` | string[] | 必须包含的章节 |
| `commandReferences` | string[] | 必须写入的命令参考 |
| `styleGuide` | object | 语气、长度、命令示例等要求 |

建议所有自动生成的整份 SOUL 至少包含以下章节。

| 必含章节 | 作用 |
|---|---|
| 角色定义 | 明确“你是谁、负责什么、不负责什么” |
| 核心职责 | 列出主要工作范围 |
| 任务处理流程 | 明确收到任务后的顺序动作 |
| 看板与状态更新规范 | 统一 CLI / 状态同步要求 |
| 实时进展上报 | 明确何时必须调用 `progress` |
| 异常与阻塞处理 | 统一回退和升级逻辑 |
| 语气与输出要求 | 保持 Agent 可理解、可执行 |

### 4.6 deployment

`deployment` 定义从规范到运行环境的自动部署路径。该机制应借鉴现有 Skill 管理链路的思路：**规范落盘、元数据 sidecar、目标路径明确、重复部署时仅增量更新**。[3]

| 字段 | 类型 | 说明 |
|---|---|---|
| `projectSourcePath` | string | 项目内 Agent 目录路径 |
| `workspaceTargetPath` | string | `~/.openclaw/workspace-{agentId}/SOUL.md` |
| `deployOnSync` | boolean | 同步配置时是否自动部署 |
| `writeSpecSidecar` | boolean | 是否写入 `.registry.json` 之类 sidecar |
| `writeGeneratedSoulSnapshot` | boolean | 是否保留最近生成快照 |
| `syncScripts` | boolean | 是否同步 scripts 到 workspace |

## 4.7 openclaw.json 处理原则

`openclaw.json` 在本次改造中应被视为 **只读参考文件**。Registry、SOUL 生成、workspace 部署、看板命名与刷新优化都应优先落在项目自身目录与自动生成产物中，而不是直接覆写 OpenClaw 运行配置。这样可以降低对现网运行环境的扰动，并保留用户自行决定是否采纳建议配置的空间。

| 原则 | 说明 |
|---|---|
| 只读参考 | 允许读取 `openclaw.json` 以识别现有 Agent、模型与 workspace 信息 |
| 不直接修改 | 本次改造不自动写回、不覆盖 `openclaw.json` |
| 可给建议 | 允许在文档中输出建议配置项、建议字段与接入说明 |
| 项目侧落地 | Registry 规范、SOUL 快照、sidecar、`data/agent_config.json` 等均在项目侧维护 |
| 项目兜底 | 若 `openclaw.json` 缺失，可读取项目内 `agents.json` 继续完成规范生成与部署，但仍只接受现代命名体系 |

建议输出的内容应是“**建议配置**”而不是“**自动改写结果**”。例如，可以说明总控中心建议使用更高频心跳、所有 Agent 建议保持单 Agent 单任务串行策略、建议补充 registry sidecar 感知字段，但不应直接将这些内容写入 OpenClaw 主配置。

## 5. 目录建议

为便于 Agent 自动部署与人工排查，建议新增下列目录结构。

| 路径 | 作用 |
|---|---|
| `registry/specs/{agent_id}.json` | Agent Registry 单体规范 |
| `registry/templates/full_soul.md.tpl` | 整份 SOUL 生成模板 |
| `registry/generated/{agent_id}.SOUL.md` | 最近一次生成结果快照 |
| `agents/{agent_id}/SOUL.md` | 项目内正式生效的 SOUL 文件 |
| `data/agent_config.json` | 运行态消费的聚合配置 |
| `docs/agent_registry_spec.md` | 本规范文档 |

## 6. 推荐 JSON 示例

下面给出总控中心的推荐规范对象示例。该示例直接使用现代命名体系，不再保留任何历史兼容字段或旧目录假设。

```json
{
  "schemaVersion": "1.0.0",
  "productName": "多Agent智作中枢",
  "agentId": "control_center",
  "display": {
    "label": "总控中心",
    "roleName": "总控专家",
    "group": "总控中心",
    "expertCategory": "",
    "summary": "任务受理、首轮处理与异常升级",
    "icon": "🎛️"
  },
  "identity": {
    "positioning": "系统统一入口，负责接收任务、执行首轮判断并快速分流。",
    "coreResponsibilities": [
      "统一受理消息与任务",
      "识别是否可直接处理",
      "执行轻量修复、配置修正、信息补齐、简单问题定位",
      "在必要时升级到规划中心或触发系统性修复"
    ],
    "directHandleScope": [
      "轻量修复",
      "配置修正",
      "信息补齐",
      "简单问题定位"
    ],
    "mustEscalateScope": [
      "复杂规划",
      "多步骤执行",
      "多Agent协作",
      "需要评审的任务"
    ],
    "systemRepairScope": [
      "修改 SOUL",
      "修改看板对接",
      "修改系统级协作逻辑",
      "修改系统级接入逻辑"
    ],
    "upstream": ["用户"],
    "downstream": ["规划中心", "评审中心", "调度中心"],
    "handoffRule": "默认快速转交，不长期占用执行链路；仅系统性修复时允许长时处理。",
    "tone": "直接、稳定、清晰，不使用封建化措辞。"
  },
  "runtimePolicy": {
    "executionMode": "serial",
    "maxConcurrentTasks": 1,
    "realtimeTier": "highest",
    "keepRealtimeByDefault": true,
    "allowLongRunningExecution": true,
    "systemRepairOnlyLongRunning": true,
    "heartbeatSeconds": 5,
    "staleAfterSeconds": 20,
    "queueStrategy": "single-agent-single-task"
  },
  "soulGeneration": {
    "mode": "full_document",
    "autoGenerate": true,
    "source": "agent_registry_spec",
    "targetFile": "SOUL.md",
    "templateVersion": "1.0.0",
    "mustIncludeSections": [
      "角色定义",
      "核心职责",
      "任务处理流程",
      "看板操作",
      "实时进展上报",
      "异常与阻塞处理",
      "语气"
    ]
  },
  "deployment": {
    "projectSourcePath": "agents/control_center/SOUL.md",
    "workspaceTargetPath": "~/.openclaw/workspace-control_center/SOUL.md",
    "deployOnSync": true,
    "writeSpecSidecar": true,
    "writeGeneratedSoulSnapshot": true,
    "syncScripts": true
  }
}
```

## 7. 自动生成与自动部署流程

本项目建议将 Agent Registry 的处理流程固定为四步。这样既便于 Agent 自动执行，也便于后续排查。

| 步骤 | 输入 | 输出 |
|---|---|---|
| 1. 生成规范 | Agent 元数据、职责边界、运行策略 | `registry/specs/{agent_id}.json` |
| 2. 生成 SOUL | Registry 规范 + 模板 | `registry/generated/{agent_id}.SOUL.md` |
| 3. 发布正式 SOUL | 生成快照 | `agents/{agent_id}/SOUL.md` |
| 4. 自动部署 | 正式 SOUL + 脚本同步 | workspace 中的 `SOUL.md` 与 scripts |

建议在同步脚本中补充以下动作。

| 动作 | 说明 |
|---|---|
| `generate_registry_specs()` | 为所有已知 Agent 输出单体规范文件 |
| `generate_soul_from_registry()` | 根据规范生成完整 SOUL 快照 |
| `publish_generated_soul()` | 仅在内容变化时覆盖正式 SOUL |
| `deploy_registry_sidecars()` | 将运行所需 sidecar 写入 workspace |
| `sync_scripts_to_workspaces()` | 保持脚本同步逻辑不变 |

## 8. 与现有实现的兼容原则

本次规范升级必须遵守“**用户可见表达现代化，运行时兼容保守化**”原则。也就是说，界面、文档、SOUL 与注册层可以切换到 **多Agent智作中枢 / 总控中心 / 规划中心 / 评审中心 / 调度中心 / 专业执行组 / XX 专家** 体系，但底层 `agent_id`、OpenClaw 工作区目录、既有取数方式和主要任务状态字段应尽量保持兼容，以降低迁移风险。[1] [2] 同时，`openclaw.json` 默认仅作为识别当前运行环境的只读参考来源；若需调整其配置，应通过文档给出建议，由用户自行决定是否采纳，而不由本次改造直接写回。

| 保持兼容的内容 | 允许现代化替换的内容 |
|---|---|
| `agent_id`、workspace 路径、既有 CLI 命令 | 看板标题、角色名称、职责文案、注册元数据 |
| `data/agent_config.json` 的主结构 | 新增 `registry`、`runtimePolicy`、sidecar 文件 |
| 现有 `SOUL.md` 部署位置 | SOUL 正文内容与风格 |
| 当前取数逻辑 | 刷新调度、心跳策略、局部回显字段 |

## 9. 验收标准

只有满足下列条件，才可认为 Agent Registry 规范与自动部署链路建立完成。

| 验收项 | 判定标准 |
|---|---|
| 规范可落盘 | 每个 Agent 都有独立 registry spec 文件 |
| SOUL 可自动生成 | 可基于 spec 生成一整份完整 `SOUL.md` |
| SOUL 可自动部署 | 同步后 workspace 中的 `SOUL.md` 自动更新 |
| Agent 可自动识别 | 运行态 `data/agent_config.json` 含 registry 与 runtimePolicy |
| 总控中心实时性明确 | 总控中心默认高实时，仅系统性修复允许长时执行 |
| 串行约束明确 | 所有 Agent 运行策略均体现单 Agent 单任务 |
| 专家体系可扩展 | 新增 `XX 专家` 时无需大改前端结构 |

## References

[1]: https://github.com/cft0808/agentorchestrator "cft0808/agentorchestrator"
[2]: https://github.com/wanikua/danghuangshang "wanikua/danghuangshang"
[3]: https://opensource.org/license/mit "The MIT License"
