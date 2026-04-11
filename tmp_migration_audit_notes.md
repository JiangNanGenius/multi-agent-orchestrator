# 迁移体检临时笔记

## 已确认事实

### 1. 主启动与部署目录
- `agentorchestrator.sh` 是仓库根目录主启动脚本，用于启动看板服务与刷新循环（此前已读）。
- `scripts/run_loop.sh` 通过 `AGENTORCHESTRATOR_HOME` 指向仓库根目录，循环执行：
  - `sync_from_openclaw_runtime.py`
  - `sync_agent_config.py`
  - `apply_model_changes.py`
  - `sync_agents_overview.py`
  - `refresh_live_data.py`
- `run_loop.sh` 还会定时请求 `http://127.0.0.1:${DASHBOARD_PORT}/api/scheduler-scan`，说明刷新循环依赖本地看板 API 服务在线。
- `dashboard/server.py` 会从 `dashboard/dist` 托管前端静态资源，并从 `agentorchestrator/backend/app` 引入任务工作区逻辑，说明当前前后端链路为“本地 HTTP 服务 + dist 静态前端 + backend 服务模块复用”，而非独立前端 dev server 必需。

### 2. 权威状态机
- 权威状态枚举位于 `agentorchestrator/backend/app/models/task.py`。
- 关键状态：`ControlCenter -> PlanCenter -> ReviewCenter -> Assigned/PlanCenter/... -> Doing/Review/Done/Blocked/PendingConfirm`。
- `ReviewCenter -> Assigned` 合法；这意味着评审通过后应进入调度态，而不是继续停留在规划态。
- `STATE_AGENT_MAP` 中 `Assigned/Review/PendingConfirm` 都映射到 `dispatch_center`。

### 3. 看板脚本状态机
- `scripts/kanban_update.py` 通过解析 `agentorchestrator/backend/app/models/task.py` 中的 `STATE_TRANSITIONS` 动态加载 `_VALID_TRANSITIONS`，因此理论上和后端状态机单一来源一致。
- `cmd_state()` 会做非法状态转换校验。
- 高风险转换会被拦截为 `PendingConfirm`，不是直接生效。
- `cmd_confirm()` 的 `reject` 路径无条件回到 `Review`，不是回到原状态；这可能与 `Doing -> Cancelled`、`ReviewCenter -> Cancelled` 两类待确认场景的原语义不完全匹配。
- `cmd_done()` 直接把状态置为 `Done`，没有再校验当前状态是否允许完成；这与后端 `TaskService.transition_state()` 的严格状态转换规则不完全一致。

### 4. SOUL 与实际脚本路径
- 多个 SOUL 文件（如 `control_center`、`review_center`、`plan_center`）示例命令写的是：
  - `python3 scripts/kanban_update.py ...`
  - `python3 scripts/task_db.py ...`
- 但仓库根目录下仅存在 `scripts/kanban_update.py`，不存在 `scripts/task_db.py`。
- 实际存在的任务数据库脚本为：`agentorchestrator/scripts/task_db.py`。
- 因此，SOUL 中 `task_db.py` 命令路径在迁移后已不正确，属于会直接影响执行闭环的硬问题。

### 5. SOUL 结构与流转问题
- `registry/soul_validation_report.json`（此前已读）说明部分源 SOUL 结构不完整，部署策略为 `generated_scaffold_plus_source`。
- `review_center/SOUL.md` 中“通过”示例命令：
  - `state <taskCode> dispatch_center "评审中心通过"`
  - `flow <taskCode> "评审中心" "规划中心" "审议通过"`
- 这里存在语义不一致：状态示例意图进入调度中心，但 `flow` 却仍写回“规划中心”。
- `control_center/SOUL.md` 已明确：正式任务常规路径应转给 `plan_center`；最终结果由 `dispatch_center` 回传给 `control_center` 再回复用户。
- `review_center/SOUL.md` 原文又写“由于你是 subagent，结果会自动回传给规划中心”，与状态机中 `ReviewCenter -> Assigned` 的正式链路并存，存在“文本返回给规划中心”和“状态推进到调度中心”双轨描述，需要统一。

### 6. 旧命名/残留
- `dashboard/server.py`、`sync_agent_config.py`、SOUL 等多数位置已经使用 `AGENTORCHESTRATOR`/`多Agent智作中枢`。
- 浏览器提示摘要指出：
  - `agentorchestrator/backend/app/api/agents.py` 仍有 `audit_specialist=合规专家`、`admin_specialist=技能管理员` 等旧命名残留。
  - `agentorchestrator/frontend/src/store.ts` 仍保留 `Agent管理专家` 的兼容归一化逻辑。
  - `agentorchestrator/scripts/kanban_update_agentorchestrator.py` 仍带有旧措辞如“下旨”。
- 尚未完成全仓 `edict` 大小写不敏感扫描，需要继续执行。

## 当前待补充检查
- 继续读取 `kanban_update.py` 的委派与回写尾段，确认父子任务回写是否闭环。
- 执行全仓 `edict`/旧命名大小写不敏感 grep。
- 查找所有 `scripts/task_db.py` 引用位置，统计受影响 SOUL/代码文件。
- 查找所有 `dispatch_center`、`review_center`、`plan_center` 相关 SOUL 中的 flow/state 不一致描述。
- 必要时直接修复发现的问题，并形成最终审计报告。
