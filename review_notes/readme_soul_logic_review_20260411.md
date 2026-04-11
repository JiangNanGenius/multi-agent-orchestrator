# README / SOUL / 核心逻辑审查记录（2026-04-11）

## 审查范围

本次审查聚焦四类内容：

1. 首页与主文档口径（`README.md`、`docs/current_architecture_overview.md`、`docs/technical-architecture.md`）。
2. 核心后端执行链路（`task.py`、`task_service.py`、`orchestrator_worker.py`）。
3. 全局协作规则（`agents/GLOBAL.md`）。
4. 核心中心角色 SOUL（一线链路：`control_center`、`plan_center`、`review_center`、`dispatch_center`）。

---

## 一、当前主链路是否闭环（结论：是）

### 1) 任务状态机与自动派发链路一致

- 任务状态定义与合法流转在 `TaskState` / `STATE_TRANSITIONS` 中完整声明。
- 编排器会监听创建、状态变更、完成、停滞事件，并在状态变化时自动派发到对应中心或专家。
- `Assigned` 状态处理有“回调度中心”与“直接专家派发”的分支判定，逻辑与文档中的“调度中心承接执行分发”一致。

结论：系统核心从“建任务 → 状态推进 → 自动派发 → 汇总完成”具备可执行闭环。

### 2) 并发安全与可追溯策略成立

- 状态切换使用 `SELECT ... FOR UPDATE` 串行化同一任务写入。
- `flow_log` / `progress_log` / `todos` / `meta.workspace` 构成任务过程留痕。
- 创建任务与写入 outbox 事件同事务提交，避免“有任务无事件”或“有事件无任务”的分裂。

结论：关键一致性设计方向正确，符合治理型任务系统预期。

---

## 二、SOUL 与代码映射关系（结论：总体对齐）

### 1) 组织与角色映射基本一致

- 代码中 `STATE_AGENT_MAP` 与 `ORG_AGENT_MAP` 能覆盖中心角色与主要专家角色。
- `SOUL.md` 中“中心负责流程、专家负责执行”的分层，也能在状态映射中体现。

### 2) `/new`、看板、工作区口径方向一致

- `control_center` / `plan_center` / `dispatch_center` 均强调 `/new` 由总控中心或 watchdog 兜底，不鼓励执行层越权直触发。
- `GLOBAL.md` 强调看板必须走 CLI，SOUL 也重复了该执行约束。

结论：SOUL 规则与当前任务模型+编排器总体一致，没有发现会立即导致主链路断裂的硬冲突。

---

## 三、发现的问题与风险点

### 1) 文档引用存在失效文件（高优先级文档治理问题）

发现多个文档引用了仓库内不存在的文件：

- `README.md` 引用：`agentorchestrator/E2E_task_workspace_validation_result_2026-04-09.json`
- `docs/technical-architecture.md` 引用：
  - `agentorchestrator/E2E_task_workspace_validation_result_2026-04-09.json`
  - `agentorchestrator/DELIVERY_task_workspace_final_2026-04-09.md`

风险：读者会误以为“可复查证据”存在，但实际无法打开，削弱文档可信度。

建议：

- 若文件已迁移：更新到现有路径。
- 若文件不再公开：将引用改为实际可执行脚本（如 `agentorchestrator/scripts/e2e_task_workspace_validation.py`）并明确“当前仓库仅保留脚本，不附历史结果快照”。

### 2) SOUL 体量较大且存在“通用规则 + 角色专用细则”叠加

当前中心角色 SOUL 采用“双层规则”结构，优点是完整，缺点是：

- 新维护者难以快速识别“最终生效规则优先级”。
- 部分规则在通用段和专用段重复，后续更容易出现漂移。

建议：

- 每个 SOUL 顶部增加“最终执行优先级”与“本角色最小必读清单（3~5条）”。
- 将重复命令示例抽到共享模板，减少重复维护。

### 3) 文档中的“已验证结论”与仓库内工件可追溯性存在落差

技术文档对“all_passed=true”类结论表述较强，但对应结果工件不在当前仓库。

建议：

- 要么补回结果文件（脱敏后）。
- 要么把强结论降级为“曾在某次联调中通过，当前仓库提供复现脚本”。

---

## 四、建议的最小整改顺序

1. 先修复 README 与技术文档中的失效引用（1 次提交即可）。
2. 再做 SOUL 最小化收敛（只加“优先级 + 必读清单”，不改业务语义）。
3. 最后补一份“如何复现 E2E 验证结果”的短文档，避免后续继续依赖历史口述。

---

## 五、整体结论

- **逻辑层面**：任务状态机、编排器派发、停滞恢复、工作区元数据回写构成了可运行闭环，设计方向正确。
- **规则层面**：SOUL 与代码主线对齐，中心-专家分层清晰。
- **治理层面**：文档证据链存在“引用缺失”问题，优先应修复可追溯性，再做更细的规则减重。

