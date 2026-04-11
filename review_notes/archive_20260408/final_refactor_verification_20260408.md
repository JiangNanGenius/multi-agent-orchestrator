# multi-agent-orchestrator_public 无兼容全量重构最终复核报告

作者：**Manus AI**  
日期：2026-04-08

## 结论摘要

本轮已按“**完全重构，不保留历史兼容**”的要求，对仓库中的旧 `agent_id`、旧主入口 `main`、旧朝廷式命名、旧 SOUL/Registry 遗留产物，以及分散在脚本、前后端页面、安装脚本、文档、测试与运行链路中的历史兼容语义进行了持续清理与复核。当前 `Registry → sync → refresh → dashboard → docs → context/review` 主链路已收敛为现代英文命名体系，运行产物重生成后只保留现代 `agent_id`。

本次还额外完成了用户特别强调的两部分复核：其一是**上下文管理**，其二是**成果审核/状态流转**。结果显示，这两条核心链路已经以现代命名运行，且不存在旧 `main` / 旧朝廷命名的残留兼容入口；同时，上下文窗口管理实现已经具备压缩、归档、续接提示与对外暴露字段，成果审核链路则以当前状态机为准统一收口。

## 现代命名体系现状

| 类别 | 当前结果 |
| :--- | :--- |
| 核心中心节点 | `control_center`、`plan_center`、`review_center`、`dispatch_center` |
| 专家节点 | `code_specialist`、`data_specialist`、`docs_specialist`、`audit_specialist`、`deploy_specialist`、`admin_specialist`、`search_specialist` |
| Registry 规格产物 | 仅存在上述现代 `agent_id` 对应的 `.json` 与 `.json.lock` |
| Registry SOUL 产物 | 仅存在上述现代 `agent_id` 对应的 `.SOUL.md` |
| 已清理遗留项 | `main`、`taizi`、`zhongshu`、`menxia`、`shangshu`、`hubu`、`libu`、`bingbu`、`xingbu`、`gongbu`、`zaochao`、`libu_hr` |

## 已完成的关键修复

### 1. 同步与运行链路

已经对 `scripts/sync_agent_config.py`、`scripts/refresh_live_data.py`、`scripts/sync_from_openclaw_runtime.py`、`scripts/sync_officials_stats.py`、`scripts/kanban_update.py` 与相关脚本链路完成清理，使其不再依赖旧 `main` 或朝廷式 `agent_id` 兼容映射。当前同步与运行目标统一收敛到现代白名单，并按现代工作区路径写入 `workspace-<agent_id>`。

在重生成验证中，`sync_agent_config.py` 成功写出 **11 个 registry specs** 与 **11 个 generated SOUL snapshots**，并同步 **11 个 agents**；`refresh_live_data.py` 成功更新 `live_status.json`；运行时同步脚本在本地无运行任务时正常返回 0 task；官方状态汇总脚本成功识别 **11 个 agents**。

### 2. 安装、前端与看板

已经清理 `install.sh`、`install.ps1` 中对旧 `main` 认证目录和旧主入口路径的假设，改为现代 `control_center`/现代工作区命名。看板前端 `dashboard/dashboard.html` 以及 `agentorchestrator/frontend/src/components` 下与监控、会话、讨论、状态过滤相关的组件，也已移除对 `main` 主会话和旧命名的特殊兼容渲染。

### 3. 文档与 SOUL 基线

已清理 `docs/getting-started.md`、`docs/agent_registry_spec.md`、`docs/task-dispatch-architecture.md`、`docs/project-progress-log.md` 以及多个 `agents/*/SOUL.md`、`agents/groups/liubu.md` 中残留的旧命名示例、旧角色映射与历史兼容措辞，统一切换到现代命名体系。

### 4. 测试与验证用例

在最终验证阶段，发现部分回归测试本身仍带有旧接口或旧状态机假设，因此同步修正了测试用例，而不是为了“让旧测试通过”重新引入兼容逻辑。主要调整包括：

| 测试文件 | 调整内容 |
| :--- | :--- |
| `tests/test_sync_symlinks.py` | 去除对已删除模块级常量 `_SOUL_DEPLOY_MAP` 的依赖，改为桩化现代同步目标列表，并把 `workspace-main` 改为 `workspace-control_center` |
| `tests/test_kanban.py` | 将非法旧流转假设 `ControlCenter -> Doing` 修正为符合当前成果审核状态机的合法流转 `Assigned -> Doing` |
| `tests/test_state_machine_consistency.py` | 保持为状态机一致性兜底测试，用于验证 `kanban_update.py` 与后端 `task.py` 的状态流转完全一致 |

## 上下文管理复核结论

本轮按用户要求，对**上下文窗口管理**做了实现级复核。结论是：当前核心逻辑集中在 `agentorchestrator/backend/app/workers/dispatch_worker.py` 与 `agentorchestrator/backend/app/models/task.py`，并且已处于现代命名体系之下。

| 检查点 | 结论 |
| :--- | :--- |
| 上下文拼装入口 | 由 `dispatch_worker.py` 在派发前统一组装富上下文 |
| 上下文窗口处理 | 已具备窗口状态判断、压缩、归档、续接提示与落盘能力 |
| 对外暴露字段 | `task.py` 已将 `contextWindowStatus`、`contextWindowCompressed`、`contextWindowArchivePath`、`contextWindowContinuationHint` 序列化给 API/前端 |
| 历史命名残留 | 在本轮复核范围内未发现旧 `main`/旧朝廷式 `agent_id` 混入上下文管理主链路 |
| 额外说明 | 当前实现已经具备“上下文快满时提供处理方案”的基础能力，符合本次重构后的治理方向 |

## 成果审核与状态流转复核结论

本轮也对**成果审核链路**进行了代码级检查。结论是：当前 canonical 状态机以 `agentorchestrator/backend/app/models/task.py` 为准，`scripts/kanban_update.py` 已与其保持一致，且存在 `PendingConfirm` 等高风险操作中间态，不需要借助旧命名兼容来维持流转。

| 检查点 | 结论 |
| :--- | :--- |
| 状态机来源 | `agentorchestrator/backend/app/models/task.py` |
| 脚本侧一致性 | `scripts/kanban_update.py` 与 canonical 状态机保持一致 |
| 高风险确认 | `PendingConfirm` 仍在，且确认权限中心使用现代命名映射 |
| 旧兼容入口 | 未发现为 `main` 或旧朝廷式角色保留的额外审核分支 |
| 前端展示 | 相关面板已去除 `main` 主会话等历史标签兼容 |

## 最终验证结果

### 1. 运行产物重生成

已执行：

```bash
python3 -m py_compile scripts/sync_agent_config.py scripts/refresh_live_data.py scripts/sync_from_openclaw_runtime.py scripts/sync_officials_stats.py dashboard/server.py tests/test_sync_symlinks.py
python3 scripts/sync_agent_config.py
python3 scripts/refresh_live_data.py
python3 scripts/sync_from_openclaw_runtime.py
python3 scripts/sync_officials_stats.py
```

结果正常，无 Python 语法错误。运行时由于本机不存在 `~/.openclaw/openclaw.json`，`sync_agent_config.py` 自动回退到项目内配置源继续生成产物；这属于当前验证环境现状，不是旧命名回流。

### 2. 全仓残留扫描

针对 `docs`、`agents`、`dashboard`、`agentorchestrator/backend`、`agentorchestrator/frontend/src`、`scripts`、`tests`、`data`、`registry/specs`、`registry/generated` 做了多轮定向扫描。在最终收口后，已未命中旧 `agent_id`、旧 `main` 主入口路径或旧 SOUL/Registry 主产物引用。最后一轮扫描仅出现命令行参数中指向不存在脚本的 `grep` 警告，这不是仓库残留内容。

### 3. 回归测试

已执行：

```bash
python3 -m pytest -q tests/test_sync_symlinks.py tests/test_kanban.py tests/test_sync_agent_config.py tests/test_state_machine_consistency.py
```

结果：

> **25 passed in 1.18s**

这说明本轮无兼容重构后的关键同步逻辑、工作区脚本同步、看板状态流转、配置同步与状态机一致性均已通过验证。

## 仍需注意的边界说明

当前复核重点覆盖了真实源码、核心文档、配置、Registry 产物与测试链路，并在扫描时主动排除了 `node_modules`、构建缓存和图片/PDF/压缩包等非源码文件，以避免噪声与误报。若后续还要继续做“发布级”收口，建议在前端重新构建一次 `dist`，确保新源码与构建产物完全一致；但就本轮“**现代命名体系收口 + 运行链路无旧兼容**”目标而言，关键源码层与关键运行产物层已经完成闭环。

## 本轮结论

本项目当前已经从“残留旧命名与兼容链路并存”的状态，推进到“**核心链路仅保留现代英文 agent_id 体系**”的状态。特别是用户强调不能漏掉的**上下文管理**与**成果审核**两部分，也已完成实现级检查与验证，不再依赖旧 `main` 或朝廷式命名。

如果你下一步要我继续做，我建议直接进入两个后续动作之一：其一是帮你把这些修改整理成一组可审阅的提交边界；其二是继续做发布前清单，例如前端重构产物重建、README 总说明统一、以及一次更严格的发布前 diff 审核。
