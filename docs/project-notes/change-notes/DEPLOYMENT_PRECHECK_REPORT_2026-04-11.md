# 多-Agent 智作中枢部署前复核报告（2026-04-11）

作者：**Manus AI**

## 复核待办清单

| 状态 | 项目 | 结论 |
| :--- | :--- | :--- |
| [x] | 检查仓库当前分支与提交状态 | 本地 `main` 与 `origin/main` 指向同一提交，但仓库并非完全干净，仍存在未跟踪文件。 |
| [x] | 检查安装、启动、循环刷新与 systemd 入口 | 已定位并核对 `install.sh`、`start.sh`、`scripts/run_loop.sh`、`agentorchestrator.sh`、`agentorchestrator.service`。 |
| [x] | 检查部署文档与脚本行为是否一致 | 存在若干不一致，尤其是 Agent 覆盖范围、运行时注册口径与环境变量说明。 |
| [x] | 检查 AI 部署提示词与 SOUL 完整性 | 运行时存在自动补强机制，主链路基本齐备，但部分源文件仍依赖生成骨架补齐章节。 |
| [x] | 执行低风险静态验证 | 关键 Python 文件 `py_compile` 通过，关键 Shell 入口 `bash -n` 通过。 |
| [ ] | 进行真实部署演练 | 本轮未执行，以避免直接改写本地运行时配置与 Gateway 状态。 |

## 一、总体判断

本轮复核结论是：**项目已经具备“可部署基础”，但还不适合在完全不加人工校正的情况下直接上线**。从静态层面看，关键 Python 与 Shell 入口未发现语法级错误，说明主脚本链路至少能够通过基础解析检查；同时，AI 部署提示词并非裸奔状态，仓库中已经存在标准化 SOUL 生成逻辑、完整性校验报告，以及面向运行时的自动补强机制。[1] [2] [3] [4]

不过，当前阻碍“放心部署”的问题主要不在语法，而在**部署口径不统一**。最值得重视的一点是，安装脚本中多处仍使用硬编码的 11 个 Agent 列表，而同步脚本与注册表体系已经把 `expert_curator` 纳入现代标准 Agent 序列。这意味着如果仅按当前安装脚本执行，本地 workspace 创建、运行时注册建议、资源软链接和认证同步都可能遗漏该角色，形成“注册表是 12 角度、安装脚本是 11 角度”的断层。[5] [6]

## 二、部署链路复核结果

| 模块 | 现状 | 风险等级 | 说明 |
| :--- | :--- | :--- | :--- |
| 安装主链路 | 基本完整 | 中 | `install.sh` 会依次执行 workspace 创建、运行时注册检查、数据初始化、资源链接、可见性设置、认证同步、前端构建、首次同步和 Gateway 重启。[7] |
| 本地统一启动 | 可用 | 低 | `agentorchestrator.sh` 负责看板服务与刷新循环的 PID 管理、日志管理和健康检查，适合作为常驻启动入口。[8] |
| systemd 守护化 | 可用但说明偏少 | 中 | `agentorchestrator.service` 已提供 `WorkingDirectory`、自动重启和环境变量示例，但文档没有把它作为标准部署流程写清楚。[9] |
| 刷新循环 | 条件可运行 | 中 | `scripts/run_loop.sh` 依赖本地 OpenClaw CLI；如果缺失，`agentorchestrator.sh` 会退化为只读模式。[8] |
| 前端构建 | 脚本支持 | 低 | `install.sh` 已内置 `npm install` 与 `npm run build`，并在构建后检查 `dashboard/dist/index.html` 是否生成。[7] |
| Docker / 容器化 | 缺失 | 高 | 仓库当前没有标准 `Dockerfile`、`docker-compose.yml` 或 `.env.example`，因此容器化部署仍需自行补齐。 |

从部署顺序上看，脚本设计本身是清楚的。`install.sh` 的后半段明确执行 `sync_auth`、`build_frontend`、`first_sync` 与 `restart_gateway`，这与“安装完成后即可进入同步和看板启动准备状态”的目标是一致的。[7] 另一方面，`agentorchestrator.sh` 对服务启动失败、PID 残留、健康检查失败都做了基础兜底，因此**如果你走本机脚本部署路线，推荐以 `agentorchestrator.sh` 或 systemd 作为日常运维入口，而不是手工散落执行多个命令**。[8] [9]

## 三、最关键的不一致：Agent 覆盖范围存在断层

当前最需要你在部署前处理的问题，是 **`expert_curator` 已进入注册表与运行时同步体系，但尚未进入安装脚本的硬编码 Agent 列表**。`scripts/sync_agent_config.py` 中的 `MODERN_AGENT_ID_ORDER` 已明确包含 `expert_curator`，默认专家集合也包含它；此外，SOUL 校验报告和生成快照中也都存在该角色。[1] [2] [3]

但是，`install.sh` 在 `create_workspaces()`、`register_agents()`、`link_resources()` 与 `sync_auth()` 中使用的 Agent 列表都只覆盖 11 个角色，没有 `expert_curator`。[5] [7] 这会产生三个后果。第一，首次安装时不会为该角色创建完整 workspace。第二，运行时注册建议清单不会提示这个角色。第三，认证同步不会把主模型配置复制给该角色。虽然同步脚本的部署逻辑会在后续把 `soul.md` 与脚本目录写入 `~/.openclaw/workspace-expert_curator/`，但这并不等于安装主链路已经完整覆盖其注册与认证要求。[1] [5]

> 这类问题最危险的地方在于：系统看起来“多数都能跑”，但一旦调度流真正把任务送到该角色，才会暴露出缺失配置或注册不全的问题。

## 四、环境变量与部署说明的缺口

当前仓库对于环境变量的处理是“代码里已经支持，但文档层面没有系统说明”。`agentorchestrator.sh` 与 `agentorchestrator.service` 只明确暴露了 `AGENTORCHESTRATOR_DASHBOARD_HOST` 和 `AGENTORCHESTRATOR_DASHBOARD_PORT` 这两个启动参数。[8] [9] 但代码层面至少还存在以下几组部署相关配置：

| 配置类别 | 代码位置 | 当前情况 | 部署影响 |
| :--- | :--- | :--- | :--- |
| 看板协作 LLM | `dashboard/court_discuss.py` | 支持 `OPENCLAW_LLM_API_KEY`、`OPENCLAW_LLM_BASE_URL`、`OPENCLAW_LLM_MODEL` | 若需要讨论/协作类能力，需显式配置，否则走其他后备路径。[10] |
| 后端数据库 | `agentorchestrator/backend/app/config.py` | 支持 `DATABASE_URL` 或 Postgres 分项配置 | 若启用 `agentorchestrator/backend`，生产库连接需要单独整理，不宜使用默认值。[11] |
| 缓存 / Redis | `agentorchestrator/backend/app/config.py` | 默认 `redis://localhost:6379/0` | 若部署后端能力，Redis 也需纳入运维清单。[11] |
| 服务安全 | `agentorchestrator/backend/app/config.py` | `secret_key` 默认仍为占位值 | 生产环境必须替换。[11] |
| 网关与通知 | `agentorchestrator/backend/app/config.py` | 包含 `openclaw_gateway_url`、飞书 webhook 等 | 若需要调度联动与告警，必须逐项确认。[11] |

进一步看，Alembic 配置文件也明确写了“运行时优先读取 Settings / DATABASE_URL”，说明后端数据库配置是有正式入口的，只是目前未形成统一部署说明。[12] 因此，**如果你本次只部署老看板链路，现有说明勉强够用；如果你还准备把 `agentorchestrator/backend` 一并上线，那么当前文档显然不够，至少要补一份 `.env.example` 或“生产变量清单”**。[11] [12]

## 五、AI 部署提示词检查结果

本轮对“AI 部署提示词”这一项的判断是：**主链路可用，但源文件层面尚未完全标准化，当前依赖自动补强机制兜底**。`scripts/sync_agent_config.py` 中已经定义了标准必备章节，包括“角色定义、核心职责、任务处理流程、看板操作、实时进展上报、异常与阻塞处理、语气”等七部分；若源 `SOUL.md` 缺项，会自动生成标准骨架并与原始内容拼接后再部署到运行时 workspace。[1]

这一点在 `registry/soul_validation_report.json` 里可以直接看到。`plan_center`、`expert_curator` 和 `search_specialist` 的源 `SOUL.md` 仍被标记为缺少“看板操作”章节，因此当前部署策略不是直接使用 source，而是 `generated_scaffold_plus_source`。[2] 同时，`registry/generated/expert_curator.SOUL.md` 已展示出补强后的完整形态，其中明确包含标准章节和 `kanban_update.py` 命令模板，说明**真正写入运行时的 AI 提示词并不缺部署所需的看板操作指令**。[3]

另外，仓库内还有一份面向操作层的 `docs/ai_deployment_checklist_and_prompts_20260408.md`，这表明项目已经开始把“AI 部署提示词”从隐式脚本逻辑向显式文档沉淀推进。[4] 换句话说，当前不是“没有 AI 部署提示词”，而是“提示词体系已有，但源码标准化尚未全部收口”。如果现在就部署，**功能上大概率能跑；但如果你想把部署交给别人复用，最好把三个仍缺章节的源 SOUL 也补齐到正式版，减少对生成补丁的依赖**。[1] [2]

## 六、文档与脚本的一致性评价

`docs/getting-started.md` 已经描述了安装、认证同步、前端构建和首次同步等主流程，这一点与 `install.sh` 的真实行为总体相符。[7] [13] 但仍有三处需要你注意。

第一，文档没有突出说明 `install.sh` 当前对运行时注册采取的是“**只读建议，不直接写回**”策略，而脚本中已经明确写入 `data/openclaw_registry_suggestions.json` 并提示用户手工处理缺失项。[5] 这一点对首次部署非常关键，因为很多人会误以为脚本已自动完成注册。

第二，文档没有把 `expert_curator` 漏配风险说清楚。由于脚本本身仍是硬编码列表，读文档的人很难意识到“仓库已有 12 角色，但安装入口只铺 11 个”的问题。[5] [6]

第三，部署说明仍偏向本机脚本路径，缺少一份简洁、单独成篇的“生产部署清单”。因此使用者需要在多个文件之间来回比对 `install.sh`、`agentorchestrator.sh`、`agentorchestrator.service` 和 `docs/getting-started.md` 才能还原完整路径。[7] [8] [9] [13]

## 七、本轮已执行的验证

本轮只执行了**低风险静态验证**，没有触发会改写运行时配置的真实安装或重启动作。验证结果如下：

| 验证项 | 结果 | 说明 |
| :--- | :--- | :--- |
| `python3 -m py_compile scripts/sync_agent_config.py scripts/sync_agents_overview.py scripts/refresh_live_data.py dashboard/server.py` | 通过 | 关键 Python 入口无明显语法错误。 |
| `bash -n install.sh start.sh agentorchestrator.sh scripts/run_loop.sh` | 通过 | 关键 Shell 入口无明显语法错误。 |
| 真实执行 `install.sh` / `openclaw gateway restart` | 未执行 | 为避免直接修改你当前环境，本轮保留为人工部署阶段执行。 |

因此，这份报告可以被理解为一次**部署前技术审查**，而不是一次“已在当前机器完成实装”的验收证明。

## 八、部署前建议

如果你现在就准备开始部署，我建议按以下优先级处理。

| 优先级 | 建议 | 原因 |
| :--- | :--- | :--- |
| P0 | 先修复 `install.sh` 中所有硬编码 Agent 列表，把 `expert_curator` 纳入创建、注册建议、资源链接和认证同步步骤 | 这是当前最可能造成角色掉队的真实缺口。[5] |
| P0 | 补一份最小可用的 `.env.example` 或部署变量清单 | 目前环境变量支持散落在代码中，不利于一次性部署。[8] [10] [11] [12] |
| P1 | 在 `docs/getting-started.md` 中明确写出“运行时注册需人工确认/补齐”的现状 | 避免部署者误判脚本已自动注册完所有 Agent。[5] [13] |
| P1 | 将 `plan_center`、`expert_curator`、`search_specialist` 的源 `SOUL.md` 直接补齐标准章节 | 让部署提示词从“运行时补强”升级为“源文件即完整”。[1] [2] |
| P2 | 增加容器化文件（如 `Dockerfile`、`docker-compose.yml`）或明确声明当前仅支持宿主机脚本部署 | 目前容器部署没有官方产物，容易让外部部署者踩坑。 |

## 九、最终结论

综合来看，**当前版本不是“不能部署”，而是“可以部署，但上线前还应做一轮很小而关键的收口”**。其中最核心的收口项只有两件：一是修复 `expert_curator` 在安装链路中的遗漏；二是补齐正式的环境变量说明。只要这两处收住，再加上把三个仍依赖补强的 SOUL 源文件整理为正式标准版，你这套系统的部署可控性会明显提升。[1] [2] [5] [11]

如果你愿意，我下一步可以直接继续帮你做两件事中的任意一件：**要么我帮你把这些部署缺口直接改掉并整理成可推送版本；要么我给你输出一份“现在就能照着执行”的最终部署操作单**。

## References

[1]: file:///home/ubuntu/multi-agent-orchestrator_public/scripts/sync_agent_config.py "scripts/sync_agent_config.py"
[2]: file:///home/ubuntu/multi-agent-orchestrator_public/registry/soul_validation_report.json "registry/soul_validation_report.json"
[3]: file:///home/ubuntu/multi-agent-orchestrator_public/registry/generated/expert_curator.SOUL.md "registry/generated/expert_curator.SOUL.md"
[4]: file:///home/ubuntu/multi-agent-orchestrator_public/docs/ai_deployment_checklist_and_prompts_20260408.md "docs/ai_deployment_checklist_and_prompts_20260408.md"
[5]: file:///home/ubuntu/multi-agent-orchestrator_public/install.sh "install.sh"
[6]: file:///home/ubuntu/multi-agent-orchestrator_public/agents/expert_curator/SOUL.md "agents/expert_curator/SOUL.md"
[7]: file:///home/ubuntu/multi-agent-orchestrator_public/install.sh "install.sh"
[8]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator.sh "agentorchestrator.sh"
[9]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator.service "agentorchestrator.service"
[10]: file:///home/ubuntu/multi-agent-orchestrator_public/dashboard/court_discuss.py "dashboard/court_discuss.py"
[11]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/config.py "agentorchestrator/backend/app/config.py"
[12]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/alembic.ini "agentorchestrator/alembic.ini"
[13]: file:///home/ubuntu/multi-agent-orchestrator_public/docs/getting-started.md "docs/getting-started.md"
