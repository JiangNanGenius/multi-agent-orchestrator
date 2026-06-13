# Multi-Agent Orchestrator

> **最终公开快照 / Final Public Snapshot**
>
> 这是一套围绕复杂任务生命周期设计的多智能体编排系统。它的重点不是“让很多 Agent 同时聊天”，而是把任务变成一个**可提交、可分派、可追踪、可恢复、可交付、可回看**的工作对象。
>
> 本仓库已经完成公开发布前脱敏，作为阶段性最终版本归档。后续不再按产品主线继续维护。

[English README](./README_EN.md) / [日本語 README](./README_JA.md) / [最终 Release](https://github.com/JiangNanGenius/multi-agent-orchestrator/releases/tag/v1.0.1-final) / [项目感想与实践复盘](./docs/project-reflections.md)

## 这个项目是什么

Multi-Agent Orchestrator 是一次把长任务、多角色协作、过程可视化和任务恢复机制放进同一个系统里的工程实验。

它试图解决的问题很直接：复杂任务往往不是一次对话就能完成的。任务需要被理解、拆解、分派、执行、检查、返工、沉淀，也需要在中途卡住时能被发现和恢复。如果这些过程只散落在聊天记录、临时脚本和个人记忆里，任务越长，越容易失控。

因此这个项目把任务处理组织成一条更稳定的主线：

1. 用户提交任务。
2. 总控中心接收并整理目标。
3. 规划、评审、调度和专家角色按职责接力。
4. 前端看板持续展示状态、进展、风险和结果位置。
5. 任务完成后留下记录、工作区、记忆和可复盘材料。

如果用一句话概括，它更像是一个面向 AI 任务的“协作中枢”，而不是一个普通聊天界面。

## 为什么这是最终版本

这个项目不是因为效果差而停止。相反，它已经跑通过真实的任务链路，也能在目标模式下让任务自己推进，很多最终产物的效果并不差。

真正的问题在于：现在模型和工具发展太快，这套架构的外部编排成本已经越来越高。任务要整理、角色要分派、状态要同步、上下文要写入、结果要回收、异常要恢复，每一步都要消耗时间和 token。再加上底层 OpenClaw 运行环境本身容易出现卡停，一旦卡住，就要等待检测、恢复、续跑和重新对齐，任务会被拖得很慢。

所以它最后呈现出一种很可惜的状态：能完成，效果也不错，过程也可追踪，但效率太低、token 太重、等待太多。继续修补当然可以，但那已经不再是维护这个项目，而是要重新设计一套更适合新模型能力的新架构。

因此，这个仓库被整理成最终公开快照：保留代码、界面、文档、流程图和经验教训，让它作为一个阶段的工程样本留下来。

## 一眼看懂界面

下面是经过裁切和必要脱敏后的最终公开预览图。它们展示的是这套系统最核心的用户路径：看全局、查任务、看协作、管 Agent、用技能、看记忆、做搜索。

| 模块 | 预览 |
| --- | --- |
| 启动与准备状态 | ![启动与准备状态](./docs/previews/preview-01.png) |
| 任务中心 | ![任务中心](./docs/previews/preview-02.png) |
| 任务详情与生命周期 | ![任务详情与生命周期](./docs/previews/preview-03.png) |
| 工作区与交接信息 | ![工作区与交接信息](./docs/previews/preview-04.png) |
| 工作区文件入口 | ![工作区文件入口](./docs/previews/preview-05.png) |
| 看门狗与恢复设置 | ![看门狗与恢复设置](./docs/previews/preview-06.png) |
| 执行历史 | ![执行历史](./docs/previews/preview-07.png) |
| 自动化控制中心 | ![自动化控制中心](./docs/previews/preview-08.png) |
| 协作房间 | ![协作房间](./docs/previews/preview-09.png) |
| 任务看板 | ![任务看板](./docs/previews/preview-10.png) |
| 系统总览 | ![系统总览](./docs/previews/preview-11.png) |
| Agent 管理工作台 | ![Agent 管理工作台](./docs/previews/preview-12.png) |
| 会议讨论视图 | ![会议讨论视图](./docs/previews/preview-13.png) |
| Agent 网格 | ![Agent 网格](./docs/previews/preview-14.png) |
| Skill 管理 | ![Skill 管理](./docs/previews/preview-15.png) |
| 会议室 | ![会议室](./docs/previews/preview-16.png) |
| 记忆中心列表 | ![记忆中心列表](./docs/previews/preview-17.png) |
| 记忆详情 | ![记忆详情](./docs/previews/preview-18.png) |
| Web 搜索面板 | ![Web 搜索面板](./docs/previews/preview-19.png) |

## 基础流程图

下面几张图保留了原 README 中最重要的流程表达：任务如何进入系统、角色如何协作、状态如何推进，以及结果如何沉淀。

### 首页基础流程

![首页基础流程图](./docs/diagrams/homepage-basic-flow.png)

### 用户任务流程

![用户任务流程图](./docs/diagrams/user-task-flow.png)

### 角色调用关系

![角色调用关系图](./docs/diagrams/user-agent-call-graph.png)

### 治理生命周期

![治理生命周期图](./docs/diagrams/user-governance-lifecycle.png)

### 工作区与账本关系

![工作区与账本关系图](./docs/diagrams/user-workspace-ledger-map.png)

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 任务看板 | 集中展示任务状态、优先级、进展和结果线索。 |
| 任务详情 | 查看单个任务的背景、状态、过程记录、工作区和恢复信息。 |
| 角色编排 | 通过总控、规划、评审、调度和专家角色把复杂任务拆开推进。 |
| 协作会议 | 让多个角色围绕同一目标讨论、推进、暂停、恢复和收束。 |
| Agent 管理 | 查看和管理角色分组、职责、模型配置与协作关系。 |
| Skill 管理 | 扫描、展示和复用 OpenClaw 工作区中的技能能力。 |
| 记忆中心 | 读取长期记忆、日期记忆和任务沉淀材料，方便后续续接。 |
| 工作区治理 | 为任务建立工作区、文件账本、上下文目录、归档和回迁入口。 |
| 看门狗与恢复 | 检测卡停、超时、风险状态，并提供恢复、暂停和复盘线索。 |
| Web 搜索 | 为研究型任务提供搜索、打开、推进和主题聚合入口。 |

## 公开版包含什么

这个公开快照保留了可以帮助读者理解系统的内容：

- 前后端源码。
- Agent 角色定义、注册表和协作规范。
- 用户文档、架构文档、流程图和复盘文档。
- 示例、测试和安装脚本。
- 经过裁切和脱敏的 README 预览图。

同时，公开版删除了不适合进入公共仓库的运行态内容：

- 数据库、日志、ledger、上下文快照、任务工作区、冷归档、PID 文件、缓存、虚拟环境和依赖目录。
- API key、cookie、session、auth 配置、真实环境变量、私有路径和本机状态。
- 私有任务历史、用户数据、内部发布准备记录和未脱敏运行材料。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| [`agentorchestrator/backend`](./agentorchestrator/backend) | FastAPI 后端、任务 API、服务层、模型、worker 和兼容接口。 |
| [`agentorchestrator/frontend`](./agentorchestrator/frontend) | React / Vite 前端，看板、任务详情、会议、Agent、Skill、记忆和搜索界面。 |
| [`agents`](./agents) | Agent 角色提示词、职责说明和运行约定。 |
| [`registry`](./registry) | Agent 注册表、角色规范和生成物。 |
| [`scripts`](./scripts) | 任务同步、配置同步、文件锁、刷新监听和运维辅助脚本。 |
| [`docs`](./docs) | 用户指南、架构说明、流程图、复盘文章和专项设计文档。 |
| [`examples`](./examples) | 示例任务和使用形态。 |
| [`tests`](./tests) | 状态机、kanban、文件锁、同步和稳定记录相关测试。 |

## 文档导航

| 想了解什么 | 建议阅读 |
| --- | --- |
| 如何从用户角度理解系统 | [用户文档](./docs/user-guide.md) |
| 如何启动和接入基础环境 | [快速开始](./docs/getting-started.md) |
| 当前整体架构是什么 | [当前架构总览](./docs/current_architecture_overview.md) |
| 底层技术结构如何组织 | [技术架构](./docs/technical-architecture.md) |
| 自动化任务管理如何设计 | [自动化任务管理设计](./docs/automation-task-management-design.md) |
| Agent 注册与角色体系 | [Agent Registry Spec](./docs/agent_registry_spec.md) |
| 稳定记录机制 | [Stable Record Mechanism](./docs/stable_record_mechanism.md) |
| 远程 Skill 使用方式 | [Remote Skills Guide](./docs/remote-skills-guide.md) |
| 为什么项目停在这里 | [项目感想与实践复盘](./docs/project-reflections.md) |
| 架构重写时的取舍 | [架构重写复盘记录](./docs/architecture-reflection-notes.md) |

## 本地运行参考

这个仓库是最终公开快照，主要用于学习、复盘和二次整理。由于真实运行环境曾经经过长期调校，在新机器上直接运行可能需要按自己的 OpenClaw、Python、Node.js 和服务部署方式重新适配。

基础参考步骤如下：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd agentorchestrator/frontend
npm install
npm run build
```

后端、worker、OpenClaw 工作区、Agent 配置和服务化脚本请结合以下文档阅读：

- [快速开始](./docs/getting-started.md)
- [技术架构](./docs/technical-architecture.md)
- [当前架构总览](./docs/current_architecture_overview.md)

## 安全与隐私

这个仓库已经按公开发布标准做过脱敏整理。后续如果基于它继续运行，请不要把本地运行态数据重新提交回来，尤其是：

- `data`
- `logs`
- `ledger`
- `context`
- `task_workspaces`
- `cold_task_archives`
- `.pids`
- `.venv`
- `node_modules`
- 数据库、会话、cookie、token、auth 配置和真实环境变量

如果你 fork 之后接入真实任务，也建议把工作区、日志、归档和记忆材料全部放在仓库外部。

## 开源来源与许可

本仓库按 MIT License 发布。公开整理过程中保留了与原始参考项目相关的许可与来源信息：

- [wanikua/danghuangshang](https://github.com/wanikua/danghuangshang)
- [cft0808/agentorchestrator](https://github.com/cft0808/agentorchestrator)

再分发或继续修改时，请保留对应的 MIT License 说明与来源引用。

## 最后说明

这个项目最值得留下的，不只是代码本身，而是它在真实使用中验证过的一组判断：

- 长任务必须可追踪。
- 多角色协作必须有职责边界。
- 任务过程必须可观察。
- 结果和上下文必须能回看。
- 恢复机制能救任务，但也会带来成本。
- 当模型本身变强时，外部编排层必须变轻。

所以，这不是一个“没做成”的项目，而是一份已经完成阶段使命的工程样本。它停在这里，是因为继续往前更应该换一种架构，而不是继续给旧架构加重量。
