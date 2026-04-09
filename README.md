# Multi-Agent Orchestrator

> **中文简介：** 一套面向复杂任务治理的多智能体编排系统，强调**任务有入口、过程可见、结果可交付、历史可追溯、归档可回迁**。[1] [2] [3] [4]
>
> **English Summary:** A production-oriented multi-agent orchestration system for complex task governance, emphasizing **structured intake, visible progress, traceable delivery, recoverable context, and reversible archival**.[1] [2] [3] [4]

当前仓库的重点，不是把多个 Agent 简单堆成一个聊天窗口，而是把任务放进一条**用户能理解、团队能治理、系统能恢复、历史能沉淀**的执行链路中。[1] [2] [3] 经过本轮现代化改造，项目已经补齐任务工作区、文件化账本、冷热分层、冷归档与回迁、`/new` 刷新规则、看门狗巡检修复、飞书汇报回写以及前端操作入口，使其更接近一套可持续演进的公开工程底座，而不是一次性的演示页面。[2] [3] [4]

## Project Overview / 项目概述

**Multi-Agent Orchestrator** can be understood as a governed operating system for complex AI work. Instead of allowing multiple agents to talk freely without lifecycle control, it introduces a stable chain that covers intake, planning, review, dispatch, execution, delivery, archival, and reactivation.[1] [2] [3]

**Multi-Agent Orchestrator** 可以理解为一套面向复杂 AI 工作流的治理型操作系统。它不是让多个角色自由对话后直接给结果，而是把任务纳入一条稳定主线：**接单、整理、评审、派发、执行、交付、归档、必要时再回迁继续处理**。[1] [2] [3]

| Dimension / 维度 | Current Positioning / 当前定位 |
| --- | --- |
| Product Form / 产品形态 | A governed multi-agent orchestration platform with dashboard-based operations / 带看板操作面的多智能体治理型编排平台 |
| Core Strength / 核心能力 | Workspace-backed execution, ledger-based traceability, governed archival and reactivation / 以任务工作区、账本、归档回迁为核心的可追溯治理 |
| Main Audience / 主要读者 | Visitors, deployers, collaborators, and secondary developers / 公开访客、部署者、协作者、二次开发者 |
| Public Reading Strategy / 公开阅读策略 | README for overview, user guide for operation logic, technical doc for implementation details / 首页看概览，用户文档看使用逻辑，技术文档看底层实现 |
| Current State / 当前状态 | Core modernization completed and end-to-end validated in local environment / 主线机制已现代化改造并完成本地 E2E 联调 |

## Why This Project / 这个项目解决什么问题

In many multi-agent demos, the system looks powerful at first glance but becomes difficult to govern once tasks become longer, heavier, or collaborative. The usual failures are clear: context gets lost, progress becomes opaque, handoff is fragile, and finished work is hard to revisit. This repository addresses those gaps by introducing a task-centered lifecycle with explicit governance nodes, persistent workspace files, append-only ledgers, and archival controls.[2] [3] [4]

在许多多智能体演示系统里，最常见的问题并不是“不能聊天”，而是**任务一旦变长、变复杂、需要协作，就很难治理**。上下文会丢，过程会黑盒，交接会脆弱，历史结果也难以复用。当前仓库正是围绕这些问题进行改造：它通过任务中心化生命周期、文件化工作区、追加式账本和可逆归档机制，把复杂任务重新组织为可治理、可观察、可恢复的执行体系。[2] [3] [4]

## User-Facing Lifecycle / 用户视角的任务主线

From a user perspective, the system should be understood as a lifecycle rather than a chat session. A task enters through a unified intake point, gets organized and reviewed, is dispatched to the right role, returns progress back to the dashboard, and eventually becomes a deliverable with archival history.[1] [2]

从用户视角出发，这个系统最适合被理解成一条**任务生命周期**，而不是一次聊天会话。任务从统一入口进入系统，先被整理和评审，再分派给合适的角色执行，过程持续回写到前端，最终沉淀为结果与归档历史。[1] [2]

![用户任务生命周期图](docs/diagrams/user-governance-lifecycle.png)

| Stage / 阶段 | What Users Usually See / 用户通常看到什么 | What the System Actually Does / 系统实际在做什么 |
| --- | --- | --- |
| Intake / 提交任务 | A title, description, or template-based request is submitted / 用户提交标题、描述或模板任务 | A task object is created and a dedicated workspace is initialized / 创建任务对象并初始化独立工作区 [2] [4] |
| Planning / 规划整理 | The task enters processing and may gain a clearer structure / 任务进入处理中并被结构化 | Goals, todos, resume files, and task strategy are prepared / 准备目标、Todo、续接文件与任务策略 [2] [3] |
| Review / 审核把关 | The task may pause briefly or be returned for revision / 任务可能短暂停留或退回 | Feasibility, risk, and delivery readiness are checked / 检查可行性、风险与交付准备度 [3] |
| Dispatch / 调度派发 | Progress begins to change continuously / 进度开始动态变化 | The task is routed to suitable specialists or centers / 按角色职责继续派发 [3] |
| Delivery / 结果交付 | Users receive output, summary, and next-step hints / 用户看到结果、摘要与下一步建议 | Results are consolidated and written back into task context / 汇总结果并回写任务上下文 [1] [4] |
| Archival / 归档沉淀 | The task can leave the hot path but remain queryable / 任务离开热路径但仍可查询 | Workspace state is archived and kept ready for future reactivation / 工作区状态被归档且保留后续回迁能力 [2] [4] |

## Key Modernization Highlights / 本轮现代化改造重点

The current public version already includes the major foundational upgrades completed in this round. These upgrades are not just naming cleanups or documentation polishing; they reshape how tasks are stored, resumed, displayed, and governed across the whole stack.[2] [3] [4]

当前公开版本已经纳入本轮主线改造完成项，而且这些改造并不只是命名清理或文档润色，而是直接重构了任务在**存储、续接、展示与治理**上的工作方式。[2] [3] [4]

| Capability / 能力 | What It Means / 含义 | Current Status / 当前状态 |
| --- | --- | --- |
| Task Workspace / 任务工作区 | Each task gets its own file-based workspace with README, TODO, HANDOFF, TASK_RECORD, STATUS, context, and ledgers / 每个任务自动生成独立文件工作区 [2] [4] | Completed / 已完成 |
| File Ledger / 文件化账本 | Progress, handoff, reporting, and repair events are appended into structured ledgers / 进度、交接、汇报、修复通过账本长期沉淀 [2] [4] | Completed / 已完成 |
| Cold/Hot Tiering / 冷热分层 | Active work stays hot; inactive or finished work can move cold without losing history / 活跃任务留在热区，封存任务进入冷区 [2] [4] | Completed / 已完成 |
| Archive Reactivation / 归档回迁 | Cold tasks can be reactivated back to hot storage and continue processing / 冷归档任务可重新激活回热区继续处理 [2] [4] | Completed / 已完成 |
| `/new` Refresh Rule / 上下文刷新规则 | The system can explicitly recommend refresh and resume order when context pressure rises / 上下文压力升高时可给出刷新建议与标准恢复顺序 [2] [4] | Completed / 已完成 |
| Watchdog / 看门狗巡检 | Stalled or inconsistent tasks can be inspected, annotated, and partially repaired / 对停滞或不一致任务进行巡检、标记与修复 [2] [4] | Completed / 已完成 |
| Feishu Reporting / 飞书汇报 | Key task events can be written back into reporting metadata and report ledgers / 关键任务事件可回写汇报元数据与 reports 账本 [2] [4] | Completed / 已完成 |
| Frontend Entry Completion / 前端入口补齐 | Dashboard now exposes workspace paths, file entries, archive actions, refresh hints, and watchdog fields / 前端已补齐工作区、归档回迁、刷新建议与巡检状态入口 [2] [4] | Completed / 已完成 |

## Workspace and Ledger Model / 任务工作区与账本模型

One of the most important architectural changes is the introduction of a dedicated workspace per task. This turns every task into a persistent, inspectable, resumable unit instead of leaving recovery dependent on short-term conversation memory alone.[2] [4]

本轮最重要的底层变化之一，是为每个任务建立独立工作区。这样一来，任务不再只是数据库里的一条状态记录，而是变成一个**可检查、可恢复、可交接**的持久化工作单元，不再过度依赖短期对话记忆。[2] [4]

![任务工作区与账本结构图](docs/diagrams/user-workspace-ledger-map.png)

| File or Directory / 文件或目录 | Purpose / 用途 |
| --- | --- |
| `README.md` | Quick task overview and reading entry / 任务总览与进入入口 [2] |
| `TODO.md` | Pending items and execution checklist / 待办清单与执行检查项 [2] |
| `HANDOFF.md` | Handoff and continuation summary / 交接与续接摘要 [2] |
| `TASK_RECORD.json` | Structured task metadata / 结构化任务元数据 [2] |
| `STATUS.json` | Script-friendly status snapshot / 便于脚本读取的状态快照 [2] |
| `context/latest_context.json` | Latest context snapshot for resume / 最新上下文恢复快照 [4] |
| `ledger/*.jsonl` | Append-only records for progress, reports, and repairs / 进度、汇报、修复等追加式账本 [2] [4] |

## Archival and Reactivation / 归档与回迁机制

Archival in this project does not mean a task is permanently dead. Instead, it means the task leaves the active processing path while keeping enough metadata and workspace continuity to be reactivated later. This is particularly important for large or long-running projects that should not permanently occupy hot storage.[2] [4]

本项目中的“归档”并不等于任务生命周期彻底结束，而是指任务暂时退出活跃处理路径，但仍保留足够的元数据和工作区连续性，以便后续重新激活。对于体量较大或历史沉淀较多的项目，这一点尤其关键，因为它避免了热区长期被历史任务占满。[2] [4]

![冷热分层与归档回迁流程图](docs/diagrams/user-cold-hot-archive-flow.png)

## Context Refresh and Recovery / 上下文刷新与恢复链

Long tasks eventually face context pressure. Instead of hiding this problem, the project makes it explicit through the `/new` recommendation structure. When context becomes critical or watchdog signals attention, the system can mark that refresh is recommended and provide a recovery order for the next session.[2] [4]

长链路任务最终一定会遇到上下文压力。本项目不是把这个问题隐藏起来，而是通过 `/new` 建议结构把它显式化。当上下文窗口变得紧张，或者看门狗提示需要注意时，系统会明确给出是否建议刷新，以及下一轮应该按照什么顺序恢复任务。[2] [4]

![上下文刷新与续接恢复图](docs/diagrams/user-new-refresh-flow.png)

> Recommended resume order / 推荐恢复顺序：`README.md → HANDOFF.md → TODO.md → TASK_RECORD.json → context/latest_context.json`.[4]

## Governance, Watchdog, and Reporting / 治理、巡检与汇报闭环

The system is not only designed to move tasks forward; it is also designed to detect when something is drifting, stalled, or incomplete. The watchdog layer provides health status, repair records, and recommended next actions, while reporting metadata helps trace what has been communicated externally.[2] [4]

系统不只是负责把任务往前推进，也负责在任务**漂移、停滞或不完整**时主动发出信号。看门狗层会提供健康状态、修复动作和推荐下一步；汇报回写则用来保留任务对外同步的结构化记录。[2] [4]

![任务工作区治理联动图](docs/diagrams/technical-workspace-governance-flow.png)

## Documentation Map / 文档阅读入口

To avoid turning the homepage into a mixed document of product copy, technical internals, stage notes, and temporary audits, the repository now uses a layered reading strategy. Start with the homepage, continue with the user guide if you want the operational logic, and then move into the technical architecture if you want implementation details.[1] [2] [3]

为了避免首页再次变成产品说明、技术设计、阶段记录和临时审计的混合体，当前仓库采用分层阅读策略。先看首页，再根据需求进入用户文档和技术文档，会比直接扎进零散实现文件更稳妥。[1] [2] [3]

| If You Want To Know / 如果你想了解 | Read This / 推荐阅读 |
| --- | --- |
| What the project is and what changed publicly / 项目是什么、公开口径怎么理解 | [`README.md`](README.md) |
| How a task is used, resumed, archived, and reactivated / 任务如何使用、续接、归档与回迁 | [`docs/user-guide.md`](docs/user-guide.md) |
| How the workspace, ledger, watchdog, and frontend fields are implemented / 工作区、账本、看门狗与前端字段如何落地 | [`docs/technical-architecture.md`](docs/technical-architecture.md) |
| What the current architecture looks like in more traditional terms / 更传统的架构分层与处理链路说明 | [`docs/current_architecture_overview.md`](docs/current_architecture_overview.md) |
| What was completed in this modernization round / 本轮改造到底做了哪些事 | [`TODO_task_workspace_ledger.md`](TODO_task_workspace_ledger.md) |
| What the end-to-end validation covered / E2E 验证覆盖了什么 | [`edict/E2E_task_workspace_validation_result_2026-04-09.json`](edict/E2E_task_workspace_validation_result_2026-04-09.json) |

## Demo Preview / 当前界面预览

The public repository keeps several current-state previews so visitors can immediately understand the dashboard operating surface. These previews do not replace hands-on use, but they help clarify that the system already exposes unified intake, task-oriented panels, and governed operations rather than a single chat box.[1]

公开仓库保留了几张当前运行态预览图，目的是让访客一进入仓库就能理解系统的操作面已经不是单一聊天框，而是一个围绕任务组织的看板式工作台。[1]

| Module / 模块 | What It Shows / 展示重点 | Preview / 预览 |
| --- | --- | --- |
| Task Publishing / 任务发布 | Unified intake for governed task creation / 面向治理型任务创建的统一入口 | ![任务发布运行态预览](docs/previews/dashboard-task-publish.webp) |
| Skill Management / 技能管理 | Background-task style skill orchestration and history / 面向后台任务化技能操作与历史查看 | ![技能管理运行态预览](docs/previews/dashboard-skill-management.webp) |
| AI Search / AI 搜索引擎 | Agent-driven search task launch and expert selection / 面向 Agent 驱动搜索任务与专家选择 | ![AI 搜索引擎运行态预览](docs/previews/dashboard-web-search.webp) |

## Classic Screenshots / 经典界面截图

In addition to the preview cards above, the repository also keeps classic dashboard screenshots that are useful for understanding the main board view and task-detail interaction in a more literal way. They are especially helpful for readers who want to inspect the visual structure of the task board and the governance-oriented detail panel.[1]

除了上面的主预览图外，仓库也保留了更传统的界面截图，用于直观看到任务看板总览与任务详情交互。这组截图更适合帮助读者理解看板布局、任务卡片形态与治理型详情面板的视觉结构。[1]

| Screenshot / 截图 | Focus / 展示重点 |
| --- | --- |
| ![任务看板总览](docs/screenshots/01-kanban-main.png) | Main dashboard board with task cards, top navigation, and governed workspace surface / 展示任务卡片、顶部导航与总体工作台结构 |
| ![任务流转详情](docs/screenshots/03-task-detail.png) | Task detail dialog with stage flow, actions, and execution log area / 展示任务阶段流转、详情操作与执行日志区域 |

## Repository Structure / 目录速览

| Path / 路径 | Purpose / 作用 |
| --- | --- |
| `dashboard/` | Dashboard shell and runtime-facing UI entry / 看板壳层与运行期交互入口 |
| `edict/backend/` | Backend services, task domain logic, workspace integration / 后端服务、任务领域逻辑与工作区集成 |
| `edict/frontend/` | Frontend application and governed operation panels / 前端应用与治理型操作面板 |
| `agents/` | Role prompts, responsibility boundaries, and collaboration semantics / 角色提示词、职责边界与协作语义 |
| `docs/` | Public guides, technical documents, diagrams, previews, and archived notes / 用户文档、技术文档、流程图与预览素材 |
| `task_workspaces/` | Task workspace metadata and active/cached task directories / 任务工作区元数据与活跃任务目录 |
| `cold_task_archives/` | Cold archival storage for reactivatable tasks / 支持回迁的冷归档目录 |

## Attribution / 来源与致谢

This project is maintained and modernized by **江南奇才** under the public name **Multi-Agent Orchestrator**. During its public-release cleanup and modernization, the repository drew reference from existing open-source projects and repository organization approaches. Those references have now been substantially absorbed and reworked into the current architecture.[1] [2]

本项目由 **江南奇才** 持续整理与改造，对外主名称统一为 **Multi-Agent Orchestrator**。在公开版整理与现代化重构过程中，仓库参考过既有开源实现和仓库组织方式；相关内容现已基本完成吸收、改写与重构，因此 README 仅保留必要范围内的简短致谢说明，并继续遵循 MIT License 的相关要求。[1] [2]

## Version Log / 版本日志

| Date / 日期 | Change / 变更 |
| --- | --- |
| 2026-04-09 | Rewrote the homepage README into a bilingual Chinese-English entry, updated project positioning, added user and technical documentation links, and integrated new governance flow diagrams / 将首页 README 重写为中英文双语入口，更新项目简介，加入用户文档与技术文档入口，并整合新的治理流程图 [1] [2] [3] [4] |
| 2026-04-09 | Documented task workspace, file ledger, cold/hot tiering, archive reactivation, `/new` rule, watchdog, Feishu reporting, and frontend governance entries / 同步纳入任务工作区、文件化账本、冷热分层、归档回迁、`/new` 规则、看门狗、飞书汇报与前端治理入口 [2] [3] [4] |
| 2026-04-08 | Completed major public-release cleanup, naming convergence, and dashboard preview consolidation / 完成公开版主线脱敏、命名收口与界面预览整理 [1] [3] |

## References

[1]: ./docs/user-guide.md "用户文档"
[2]: ./docs/technical-architecture.md "技术文档"
[3]: ./docs/current_architecture_overview.md "当前架构与处理逻辑总览"
[4]: ./edict/E2E_task_workspace_validation_result_2026-04-09.json "E2E 联调验证结果"
