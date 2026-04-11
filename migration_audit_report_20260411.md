# agentorchestrator 迁移后全量体检报告

## 审计结论

本次对 **agentorchestrator** 迁移后的主链路、SOUL 提示词、命令提示、状态机、启动入口、任务闭环以及全仓旧命名残留进行了逐项核查。结论是：**主链路整体可运行，核心迁移方向基本正确，但在审计过程中确认存在若干会影响执行闭环与展示一致性的真实问题，其中关键问题已完成修复；当前剩余命中主要为兼容映射与个别前端展示口径分歧，不再属于阻断级故障。**

> 简要判断：**迁移后的核心运行闭环已恢复，可继续使用；但仍建议后续补一轮“展示口径统一”清理，尤其是技能管理面板的 admin 角色默认称呼。**

| 审计项 | 结果 | 说明 |
| --- | --- | --- |
| 主启动脚本与部署目录 | 通过 | 启动入口、刷新循环与看板服务链路一致 |
| 前后端运行闭环 | 通过 | 看板服务静态托管前端，后端模型与任务逻辑被统一复用 |
| 权威状态机与命令脚本 | 基本通过 | 主状态机来源统一，但命令脚本仍有两个设计级风险点 |
| SOUL 命令提示完整性 | 通过 | 关键错误路径已修复，命令提示可执行 |
| review → dispatch 执行顺序 | 已修复 | 原有文本与状态机不一致，现已统一 |
| 根目录 `scripts/task_db.py` 路径兼容 | 已修复 | 已补齐兼容入口，恢复 SOUL 示例命令可执行性 |
| `edict` 残留 | 通过 | 核心源码与 SOUL 精确扫描未发现残留 |
| 旧称谓残留 | 部分保留为兼容 | 剩余命中主要为兼容别名；另有一个前端展示口径分歧待后续统一 |

## 一、主启动、部署入口与前后端链路

本次核查确认，仓库根目录的 `agentorchestrator.sh` 仍然是统一启动入口；刷新循环脚本 `scripts/run_loop.sh` 通过 `AGENTORCHESTRATOR_HOME` 绑定仓库根目录，周期性执行运行时同步、Agent 配置同步、模型变更应用、总览刷新与实时数据刷新，并依赖本地看板 API `http://127.0.0.1:${DASHBOARD_PORT}/api/scheduler-scan` 保持任务调度扫描。

`dashboard/server.py` 负责托管 `dashboard/dist` 的静态前端，同时直接复用 `agentorchestrator/backend/app` 中的任务模型与服务层逻辑。这说明迁移后的生产链路是 **“看板服务统一承载前端页面 + 后端任务服务逻辑复用”**，而不是依赖独立前端开发服务器。这一点与主启动脚本调用方式、刷新循环依赖关系和部署目录组织是相互一致的。

| 检查对象 | 观察结果 | 判断 |
| --- | --- | --- |
| `agentorchestrator.sh` | 仍为主启动脚本 | 一致 |
| `scripts/run_loop.sh` | 绑定仓库根目录并驱动全量刷新链路 | 一致 |
| `dashboard/server.py` | 静态托管前端并复用后端逻辑 | 一致 |
| 前后端协作方式 | 非 dev server 强依赖，而是统一 HTTP 服务闭环 | 一致 |

## 二、权威状态机与执行顺序核查

后端权威状态枚举位于 `agentorchestrator/backend/app/models/task.py`。审计时确认，`scripts/kanban_update.py` 并未自行维护另一套独立状态表，而是动态加载后端模型中的 `STATE_TRANSITIONS`，这意味着命令层与后端理论上共享单一状态来源。

进一步核查后可确认：**`ReviewCenter -> Assigned` 是合法转换**，而 `Assigned / Review / PendingConfirm` 在 `STATE_AGENT_MAP` 中都归属 `dispatch_center`。因此，从设计上说，**评审通过后的正式链路应当进入调度中心，而不是回到规划中心**。此前评审中心 SOUL 的文案中存在“状态准备进入调度，但 flow 又写回规划中心”的不一致，属于迁移后典型的顺序闭环问题。

不过，命令脚本层仍保留两个设计级风险，虽然不阻塞本次迁移主结论，但值得单独记录：

1. `cmd_confirm()` 的 `reject` 路径会直接回到 `Review`，并不是回到发起待确认前的原状态，因此某些被拦截的高风险转换在驳回后可能产生语义偏移。
2. `cmd_done()` 会直接把任务置为 `Done`，没有像后端 `TaskService.transition_state()` 那样再次做完整合法性校验，因此命令脚本与服务层严格度仍不完全对齐。

| 状态链路问题 | 现状 | 风险等级 |
| --- | --- | --- |
| `ReviewCenter -> Assigned` 设计意图 | 清晰且与调度中心归属一致 | 低 |
| review 通过后 SOUL 文案是否一致 | 已修复 | 已消除 |
| `cmd_confirm reject` 回退到 `Review` | 仍存在 | 中 |
| `cmd_done` 未复核合法转换 | 仍存在 | 中 |

## 三、SOUL 提示词与命令提示核查结果

本次重点核查了 `plan_center`、`review_center`、`dispatch_center`、`control_center` 等 SOUL。结论是：迁移后大多数命令提示已改为新的目录与命令体系，但确实存在一个会直接影响执行闭环的真实问题，即 **SOUL 中普遍使用 `python3 scripts/task_db.py ...`，而仓库根目录原先并不存在这个文件**。

实际数据库脚本位于 `agentorchestrator/scripts/task_db.py`。这意味着，虽然 SOUL 的命令提示看起来统一，但在迁移后的真实目录结构下会直接报路径错误，属于“提示词文本正确、但命令不可执行”的硬故障。

同时，`review_center/SOUL.md` 的“通过”区段曾出现如下不一致：

> `state <taskCode> dispatch_center ...` 与 `flow <taskCode> "评审中心" "规划中心" "审议通过"` 同时存在。

这会让“状态推进到调度中心”与“文字流转仍回规划中心”并行出现，破坏链路语义统一。审计后已确认该段被修正为：

```bash
python3 scripts/kanban_update.py state <taskCode> dispatch_center "评审中心通过"
python3 scripts/kanban_update.py flow <taskCode> "评审中心" "调度中心" "审议通过"
python3 scripts/task_db.py patch-workspace <task_id> '{"latest_handoff":"评审中心已审议通过，已转入调度执行","review_result_summary":"审议通过"}' --agent review_center --summary "评审中心通过方案"
```

这说明 **评审通过 → 调度执行** 的 SOUL 提示已经与权威状态机重新对齐。

## 四、本次已完成修复

本轮审计不是只做静态报告，而是对确认的问题进行了就地修复。已完成的关键修复如下。

| 修复项 | 文件 | 修复结果 |
| --- | --- | --- |
| 补齐根目录 `scripts/task_db.py` 兼容入口 | `scripts/task_db.py` | 已新增透明转发包装脚本，SOUL 旧示例命令重新可执行 |
| 验证兼容入口可执行 | `python3 scripts/task_db.py --help` | 已验证成功返回 CLI 帮助信息 |
| 修正评审通过后的流转目标 | `agents/review_center/SOUL.md` | 已从“规划中心”改为“调度中心” |
| 统一执行专家 SOUL 中旧职责称谓 | `agents/audit_specialist/SOUL.md` 等 4 个文件 | 已改为“管理专家（admin_specialist）负责规则治理、配置维护与协作管理” |
| 修复协作讨论模块默认展示名 | `dashboard/court_discuss.py` | `合规专家` → `审计专家`，`技能管理员` → `管理专家` |
| 修复模板面板展示名 | `agentorchestrator/frontend/src/components/TemplatePanel.tsx` | `合规专家` → `审计专家` |

其中，根目录 `scripts/task_db.py` 当前内容为透明转发：

```python
"""兼容入口：转发到 agentorchestrator/scripts/task_db.py。"""
from __future__ import annotations
import runpy
from pathlib import Path
TARGET = Path(__file__).resolve().parents[1] / 'agentorchestrator' / 'scripts' / 'task_db.py'
if not TARGET.exists():
    raise SystemExit(f'task_db.py not found: {TARGET}')
runpy.run_path(str(TARGET), run_name='__main__')
```

这项修复非常关键，因为它不是单纯改文案，而是直接恢复了 **SOUL 命令提示 → 实际仓库路径 → 可执行脚本** 的闭环。

## 五、`edict` 残留与旧命名扫描结果

审计时已对核心目录执行精确扫描，范围覆盖 `agents`、`agentorchestrator/backend/app`、`agentorchestrator/frontend/src`、`dashboard`、`scripts`、`registry` 等核心源码与提示词目录，并显式排除了依赖目录与构建噪声。结果如下：

### 1. `edict` 残留

核心扫描结果文件 `edict_core_hits.txt` 为空，说明在本次重点范围内：

> **未发现 `edict` 旧项目标识残留。**

### 2. 旧称谓残留

修复后再次扫描，剩余命中主要集中于以下几类：

| 剩余命中位置 | 性质判断 | 说明 |
| --- | --- | --- |
| `dashboard/server.py` 中 `合规专家`、`技能管理员` | 兼容别名 | 用于把旧中文称谓映射到规范 `agent_id` |
| `scripts/kanban_update.py` 中 `合规专家`、`Agent管理专家`、`技能管理员` | 兼容别名 | 用于兼容旧输入，不是默认展示口径 |
| `agentorchestrator/frontend/src/store.ts` 中 `Agent管理专家` | 兼容归一化 | 用于把旧文本归并到 `管理专家` |
| `agentorchestrator/frontend/src/components/SkillsConfig.tsx` 中 `技能管理员` | 兼容输入 + 展示分歧 | 该面板最终展示为“技能管理助手”，与全局“管理专家”并不完全一致 |

因此，**当前代码中已不存在“误把旧称谓当作权威展示名”的大面积问题**；剩余大多是为了兼容历史输入或旧数据而保留的归一化逻辑。但 `SkillsConfig.tsx` 仍然将 `admin_specialist` 展示为“技能管理助手”，这与全局 canonical label “管理专家”存在口径分歧，建议后续决定是否统一。

## 六、闭环性判断

围绕用户特别强调的“检查逻辑、执行顺序、任务闭环”，本次的最终判断如下。

### 1. 任务主链路

主链路 **ControlCenter → PlanCenter → ReviewCenter → DispatchCenter → ControlCenter** 已能在代码与 SOUL 文案层面相互对应。其中，review 通过后进入 dispatch 的关键歧义已修正，`scripts/task_db.py` 的路径断裂也已补齐，因此从“提示词可执行性”角度看，主链闭环已经恢复。

### 2. 命令可执行性

`kanban_update.py` 与新补齐的 `scripts/task_db.py` 共同覆盖了 SOUL 中主要命令示例，说明提示词不再停留在纸面描述，而是重新具备实际可执行性。这个问题在迁移后原本是最严重的闭环断点，现在已被修复。

### 3. 状态一致性

命令层与后端状态机共享单一来源，这是迁移后比较健康的一点。但 `cmd_done()`、`cmd_confirm(reject)` 两处仍存在“脚本实现严格度低于服务层”的情况，因此应视为 **已恢复运行闭环，但仍存在状态治理技术债**。

| 闭环层面 | 最终判断 |
| --- | --- |
| 用户入口到正式任务创建 | 闭环成立 |
| 规划提交到评审 | 闭环成立 |
| 评审通过到调度执行 | 已修复并成立 |
| 调度完成后结果回传 | 依据现有 SOUL 与主链定义成立 |
| SOUL 命令能否直接执行 | 已修复并成立 |
| 状态治理是否完全严丝合缝 | 仍有改进空间 |

## 七、仍建议后续跟进的非阻断项

虽然本次阻断项已修复，但以下问题建议在下一轮清理中继续处理：

1. **统一 `admin_specialist` 的最终对外展示名。** 当前全局元数据偏向“管理专家”，但 `SkillsConfig.tsx` 仍展示为“技能管理助手”。如果产品上需要一个唯一对外口径，建议统一。
2. **让 `cmd_done()` 复用后端更严格的合法性校验。** 这样可以消除命令脚本和服务层的行为偏差。
3. **让 `cmd_confirm()` 在驳回时回到原状态，而不是硬编码回到 `Review`。** 这样更符合待确认机制的状态语义。
4. **对历史报告类文档不做强制清洗，但可在下一轮统一归档。** 例如历史工作记录、迁移说明中的旧称谓不影响运行，但可能影响审计观感。

## 最终结论

本次迁移后的全量体检表明，**agentorchestrator 的核心链路现在已经基本自洽，且关键执行断点已被修复**。特别是以下两点最关键：

> **一是评审通过后的正式流转已重新对齐到调度中心，执行顺序恢复正确。**
>
> **二是 SOUL 中广泛引用的 `scripts/task_db.py` 已恢复为可执行入口，命令提示不再是假闭环。**

同时，核心范围内 **未发现 `edict` 残留**。当前剩余问题主要集中在兼容别名保留和少量展示口径分歧，已经不再构成迁移阻断。整体上可以判定：

> **迁移后的系统可以继续使用，主闭环已恢复；若要达到“完全统一口径”的状态，还应再做一轮前端展示名与命令脚本严格性的收尾清理。**

## 附：本次关键证据文件

| 文件 | 用途 |
| --- | --- |
| `tmp_migration_audit_notes.md` | 审计过程中的关键发现记录 |
| `migration_audit_report_20260411.md` | 本次正式审计报告 |
| `source_old_names_2.txt` | 修复后剩余旧称谓精确扫描结果 |
| `edict_core_hits.txt` | `edict` 精确扫描结果（为空） |
| `agents/review_center/SOUL.md` | 已修复评审通过 → 调度中心的 SOUL 证据 |
| `scripts/task_db.py` | 已补齐的兼容入口脚本 |
| `dashboard/court_discuss.py` | 已修复默认专家展示名 |
| `agentorchestrator/frontend/src/components/TemplatePanel.tsx` | 已修复前端模板面板展示名 |
