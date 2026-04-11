# 任务工作区与文件账本机制设计说明

## 1. 设计目标

本方案用于为当前系统补齐一套**跨 agent、跨任务、可在上下文刷新后恢复**的任务工作区与文件数据库式流转机制。核心目标不是只让任务“继续流转”，而是让每一次交接、每一轮推进、每一份产物、每一个待办和每一次归档，都能在文件系统中留下可追溯、可恢复、可审计的实体痕迹。

该机制需要满足四个核心要求。第一，**每个任务在创建时必须拥有独立工作区目录**，并以任务代号为主索引。第二，**任何 agent 的推进都应同时回写数据库字段与文件账本**，避免只存在于短上下文或瞬时消息中。第三，**在合适时机触发 `/new` 或发生上下文压缩后，后续 agent 仍可通过工作区文件恢复任务状态**。第四，**任务归档后应支持迁移到机械硬盘冷数据目录**，而 SSD 上仅保留必要索引和轻量镜像。

## 2. 现状审查结论

从现有代码可以看出，系统已经具备一部分与本方案高度相关的基础能力，但还未形成统一的“任务工作区 + 文件账本”体系。

| 现有位置 | 当前能力 | 对本方案的意义 |
| --- | --- | --- |
| `agentorchestrator/backend/app/services/task_service.py` | 负责任务创建、状态流转、进度追加、Todo 更新 | 是数据库模式下创建工作区和同步账本的主入口 |
| `agentorchestrator/backend/app/models/task.py` | 定义任务结构、`meta`、`flow_log`、`progress_log`、`todos`、`archived` 等字段 | 适合扩展工作区路径、账本索引、归档状态等元数据 |
| `agentorchestrator/backend/app/workers/dispatch_worker.py` | 已具备跨 agent 交接、上下文压缩归档、续接提示能力 | 可直接复用其上下文归档、续写提示、任务上下文打包机制 |
| `scripts/kanban_update.py` | JSON 模式下已有文件锁、审计日志、任务进展追加等文件化更新模式 | 适合作为“文件数据库”风格账本的兼容入口 |
| `scripts/refresh_live_data.py` | 将任务源数据投影为前端可消费的 `live_status.json` | 是前端展示工作区摘要、账本统计、归档路径的主要注入点 |
| `dashboard/server.py` | 旧版接口层已有任务归档、Todo 更新、workspace 数据目录选择逻辑 | 可为兼容路径和冷归档落地提供辅助接入点 |
| `agentorchestrator/frontend/src/components/TaskModal.tsx` | 当前任务详情展示状态、Todo、计时等信息 | 是新增工作区链接、账本摘要、任务链路入口的首要展示位 |

现状的关键问题在于：数据库里保存了任务状态，JSON 模式里保存了任务文件，但**并没有一个“任务自身的独立文件宇宙”**。这意味着 agent 在短上下文、跨任务接力、重新开新对话或发生记忆偏差时，恢复依据仍然不够稳定。

## 3. 总体设计原则

本方案遵循以下原则。

> **任务的真实交接面，应从“短上下文描述”升级为“任务工作区中的结构化文件集合”。**

因此，系统中的数据库、事件流和前端页面仍然保留，但它们不再是唯一事实来源，而是与任务工作区形成“双轨一致”：数据库负责检索与实时展示，文件工作区负责恢复、审计、归档和跨上下文延续。

| 设计原则 | 说明 |
| --- | --- |
| 单任务单工作区 | 每个任务创建即生成独立目录，目录名中带任务代号 |
| 文件优先恢复 | agent 接力时优先读取工作区摘要、Todo、README、taskrecord 与最新 ledger |
| 双写一致性 | 重要动作同时写入数据库字段与文件账本 |
| 追加式记录 | 账本、事件、归档记录采用 append-only，避免覆盖历史 |
| 冷热分层 | SSD 保持活跃任务，机械硬盘承接归档工作区 |
| 可索引可链接 | 前端不直接读原始文件，而读取服务端生成的结构化摘要与路径信息 |

## 4. 目录规范

建议在 OpenClaw 所在项目根下建立统一任务工作区根目录，并将冷归档目录指向机械硬盘。

### 4.1 热数据工作区根目录

```text
{OPENCLAW_PROJECT_DIR}/task_workspaces/
```

### 4.2 冷归档根目录

```text
{COLD_ARCHIVE_ROOT}/openclaw_task_archives/
```

其中 `COLD_ARCHIVE_ROOT` 应配置为机械硬盘挂载点，例如 `/mnt/hdd/cold_archive`。这样可以明确将运行中与最近任务留在 SSD，将归档工作区迁移到 HDD。

### 4.3 单任务目录命名规则

建议目录名采用：

```text
{task_code}__{slug_title}
```

例如：

```text
JJC-20260409-001__front_ui_workspace_ledger
```

这样既能保证以任务代号做精确索引，也兼顾人工查看时的可读性。

## 5. 单任务工作区结构

每个任务创建时自动生成以下结构。

```text
task_workspaces/
└── JJC-20260409-001__front_ui_workspace_ledger/
    ├── README.md
    ├── TODO.md
    ├── TASK_RECORD.json
    ├── HANDOFF.md
    ├── LINKS.md
    ├── STATUS.json
    ├── context/
    │   ├── latest_context.json
    │   ├── continuation_hint.md
    │   └── snapshots/
    ├── ledger/
    │   ├── events.jsonl
    │   ├── progress.jsonl
    │   ├── dispatches.jsonl
    │   ├── todos.jsonl
    │   └── archive.jsonl
    ├── artifacts/
    │   ├── drafts/
    │   ├── outputs/
    │   ├── references/
    │   └── attachments/
    ├── agent_notes/
    │   ├── control_center.md
    │   ├── plan_center.md
    │   └── ...
    └── exports/
        └── summary_for_resume.md
```

## 6. 核心文件职责

### 6.1 `README.md`

该文件是**任务入口说明书**，面向任何接手该任务的新 agent 或刷新后的续接 agent。内容应包括任务目标、当前状态、最新摘要、关键文件、下一步建议和恢复指引。

建议包含如下章节：

| 章节 | 内容 |
| --- | --- |
| 任务概况 | 任务代号、标题、创建时间、优先级、当前状态 |
| 当前结论 | 当前已知结论与阶段产出 |
| 下一步建议 | 最建议继续执行的动作 |
| 关键文件 | Todo、taskrecord、handoff、产物目录、上下文快照路径 |
| 恢复提示 | 如果发生 `/new`，先读哪些文件 |

### 6.2 `TODO.md`

该文件是**人工可读的任务待办清单**，采用 Markdown 复选框，适合前端摘要和人工查看。每次 Todo 更新时，同时同步数据库中的 `todos` 与 `ledger/todos.jsonl`。

### 6.3 `TASK_RECORD.json`

该文件是**任务主索引记录**，相当于单任务的文件数据库主表。它不是 append-only，而是保存任务当前快照，便于快速读取。

建议结构如下：

```json
{
  "task_id": "uuid",
  "task_code": "JJC-20260409-001",
  "trace_id": "...",
  "title": "前端工作区账本机制改造",
  "description": "...",
  "created_at": "...",
  "updated_at": "...",
  "state": "Doing",
  "priority": "高",
  "creator": "江南奇才",
  "current_owner": "plan_center",
  "current_org": "规划中心",
  "workspace_path": "...",
  "archive_status": "hot",
  "cold_archive_path": "",
  "latest_summary": "...",
  "latest_handoff": "请下一个 agent 继续完成前端接入",
  "context_refresh_recommended": true,
  "context_resume_files": [
    "README.md",
    "HANDOFF.md",
    "context/latest_context.json"
  ],
  "linked_tasks": [
    {
      "task_id": "...",
      "relation": "parent"
    }
  ],
  "stats": {
    "todo_total": 8,
    "todo_done": 3,
    "progress_count": 14,
    "dispatch_count": 5,
    "artifact_count": 7
  }
}
```

### 6.4 `HANDOFF.md`

该文件用于记录**最近一次交接说明**。其作用比 README 更聚焦，主要回答“下一个 agent 现在应该接什么、看什么、先做什么”。

### 6.5 `LINKS.md`

该文件用于记录与当前任务相关的**上下游任务链路**、外部链接、依赖资源、引用文件、父子任务和并行任务。

### 6.6 `STATUS.json`

该文件保存前端高频读取所需的精简状态摘要，包括当前阶段、Todo 完成率、最近事件时间、是否建议 `/new` 刷新、是否已归档等。

## 7. 账本设计

账本应采用 JSONL 追加式结构，以确保任何 agent 的动作都形成不可轻易覆盖的链式记录。它不必真的实现密码学区块链，但应具备“顺序追加、上条引用、可验证完整性”的特征。

### 7.1 建议账本文件

| 文件 | 作用 |
| --- | --- |
| `ledger/events.jsonl` | 所有重要事件统一总账本 |
| `ledger/progress.jsonl` | 进展更新专项账本 |
| `ledger/dispatches.jsonl` | agent 之间的派发与交接账本 |
| `ledger/todos.jsonl` | Todo 变更账本 |
| `ledger/archive.jsonl` | 归档与迁移账本 |

### 7.2 单条账本格式

建议每条记录至少包含顺序号、时间、事件类型、操作者、摘要、前一条哈希与当前哈希。

```json
{
  "seq": 17,
  "ts": "2026-04-09T10:11:12Z",
  "event": "progress.appended",
  "task_id": "...",
  "task_code": "JJC-20260409-001",
  "agent": "code_specialist",
  "summary": "已完成前端任务详情弹窗字段扩展",
  "payload": {
    "changed_files": [
      "agentorchestrator/frontend/src/components/TaskModal.tsx"
    ]
  },
  "prev_hash": "...",
  "hash": "..."
}
```

这套设计的重点在于：**不是为了绝对不可篡改，而是为了可追溯、可校验、可恢复**。

## 8. `/new` 刷新与上下文恢复机制

这是本方案的核心之一。考虑到 agent 上下文有限，并且跨任务后可能产生记忆漂移，必须显式设计“何时建议刷新、刷新后如何恢复”。

### 8.1 触发时机

以下情况应将 `context_refresh_recommended` 标记为 `true`：

| 触发场景 | 说明 |
| --- | --- |
| progress_log 或 flow_log 过长 | 当前上下文噪音增加，建议压缩后续接 |
| dispatch_worker 已触发 context window warning | 直接继承现有 warning/critical 机制 |
| 任务跨越多个阶段 | 例如从规划进入实现、从实现进入验证 |
| 产物文件数过多 | 更适合改用文件索引恢复而不是口头续接 |
| 用户明确要求 `/new` | 立即生成恢复包和提示 |

### 8.2 恢复包

每次建议刷新时，应更新以下文件：

| 文件 | 作用 |
| --- | --- |
| `context/latest_context.json` | 当前任务的结构化恢复包 |
| `context/continuation_hint.md` | 面向新会话的短恢复说明 |
| `exports/summary_for_resume.md` | 适合粘贴或展示在网页上的续接摘要 |

### 8.3 恢复顺序建议

刷新后的新 agent 应按以下顺序恢复：

1. 先读 `README.md` 了解整体情况；
2. 再读 `HANDOFF.md` 明确下一步；
3. 再读 `TODO.md` 判断尚未完成事项；
4. 如需精确回放，再读 `TASK_RECORD.json` 和 `context/latest_context.json`；
5. 如需追查历史，再按需读取 `ledger/*.jsonl`。

## 9. 任务索引机制

为支持“按任务代号进行索引”，应在项目级增加总索引文件。

建议位置：

```text
{OPENCLAW_PROJECT_DIR}/task_workspaces/_index/task_index.json
```

建议结构如下：

```json
{
  "by_task_code": {
    "JJC-20260409-001": {
      "task_id": "...",
      "title": "前端工作区账本机制改造",
      "workspace_path": "...",
      "archive_status": "hot",
      "state": "Doing",
      "updated_at": "..."
    }
  },
  "by_task_id": {
    "uuid": {
      "task_code": "JJC-20260409-001",
      "workspace_path": "..."
    }
  }
}
```

同时建议为归档任务单独维护：

```text
task_workspaces/_index/archive_index.json
```

## 10. 数据模型扩展建议

### 10.1 数据库 `Task.meta` 建议新增字段

无需立即新增数据库列，可先在 `meta` 中扩展，后续如稳定再升格为实体列。

| 字段 | 含义 |
| --- | --- |
| `workspace.task_code` | 任务代号 |
| `workspace.path` | 热数据工作区路径 |
| `workspace.readme_path` | README 路径 |
| `workspace.todo_path` | TODO 路径 |
| `workspace.taskrecord_path` | TASK_RECORD 路径 |
| `workspace.handoff_path` | HANDOFF 路径 |
| `workspace.links_path` | LINKS 路径 |
| `workspace.status_path` | STATUS 路径 |
| `workspace.ledger_dir` | ledger 目录 |
| `workspace.artifacts_dir` | artifacts 目录 |
| `workspace.context_dir` | context 目录 |
| `workspace.archive_status` | `hot` / `archiving` / `cold` |
| `workspace.cold_archive_path` | 冷归档目录 |
| `workspace.last_resume_export` | 最近一次续接摘要路径 |
| `workspace.refresh_recommended` | 是否建议刷新上下文 |
| `workspace.linked_tasks` | 上下游任务链路 |

### 10.2 `to_dict()` 建议补充的前端字段

前端无需直接解析 `meta.workspace` 原样结构，而应在 `to_dict()` 中导出可直接使用的字段：

| 字段 | 说明 |
| --- | --- |
| `workspaceCode` | 任务代号 |
| `workspacePath` | 当前工作区路径 |
| `workspaceStatus` | hot / cold |
| `workspaceReadmePath` | README 路径 |
| `workspaceTodoPath` | TODO 路径 |
| `workspaceTaskRecordPath` | taskrecord 路径 |
| `workspaceLinksPath` | 任务链路文件路径 |
| `workspaceLedgerDir` | 账本目录 |
| `workspaceColdArchivePath` | 冷归档路径 |
| `workspaceRefreshRecommended` | 是否建议 `/new` |
| `workspaceLatestSummary` | 恢复摘要 |
| `workspaceLinkedTasks` | 关联任务数组 |
| `workspaceStats` | Todo 数、进展数、账本条数等 |

## 11. 后端接入方案

### 11.1 FastAPI / 数据库模式

在 `TaskService.create_task()` 中完成以下动作：

1. 生成 `task_code`；
2. 创建任务工作区目录；
3. 初始化 `README.md`、`TODO.md`、`TASK_RECORD.json`、`HANDOFF.md`、`LINKS.md`、`STATUS.json`；
4. 初始化 `ledger/*.jsonl`；
5. 将路径与索引写入 `task.meta.workspace`；
6. 追加 `task.created` 到账本；
7. 更新总索引文件。

在 `transition_state()`、`add_progress()`、`update_todos()` 中同步追加账本记录，并刷新 `TASK_RECORD.json` 与 `STATUS.json`。

### 11.2 dispatch worker 接入点

`dispatch_worker.py` 已有现成的任务上下文与上下文窗口归档机制。建议在以下位置接入：

| 接入点 | 改造建议 |
| --- | --- |
| `_build_task_context()` | 增加工作区路径、README、HANDOFF、TODO 摘要引用 |
| `_build_context_window_package()` | 将归档快照写入任务工作区 `context/snapshots/`，而不是只写全局归档目录 |
| context window state 回写 | 同步更新 `STATUS.json` 与 `TASK_RECORD.json` 的刷新建议字段 |
| 任务派发前 | 将本次交接摘要追加到 `ledger/dispatches.jsonl` 和 `HANDOFF.md` |

### 11.3 JSON / legacy 模式

`kanban_update.py` 应补一层兼容：当 `create`、`progress`、`todo`、`state` 等命令执行时，如果目标任务尚无工作区，则自动补建；如已有，则同步回写工作区文件。

## 12. 前端展示方案

当前前端明显缺少“计时之外的真实链路感”。因此应在任务详情弹窗和主事项视图增加工作区与任务链路相关展示。

### 12.1 任务详情弹窗新增区域

建议在 `TaskModal.tsx` 增加一块“任务工作区”卡片，展示如下内容：

| 展示项 | 说明 |
| --- | --- |
| 任务代号 | 例如 `JJC-20260409-001` |
| 工作区状态 | 热数据 / 冷归档 / 迁移中 |
| Todo 概览 | 已完成数 / 总数 |
| 最近账本事件时间 | 最近一次推进时间 |
| 是否建议刷新 | 给出 `/new` 恢复提示 |
| 任务链路 | 父任务、子任务、关联任务 |
| 文件入口 | README、Todo、任务记录、交接说明 |

### 12.2 页面交互建议

前端不直接打开服务器任意路径，而是由后端提供安全读取接口，例如：

- `GET /api/task-workspace/{task_id}/summary`
- `GET /api/task-workspace/{task_id}/links`
- `GET /api/task-workspace/{task_id}/ledger?type=events`
- `GET /api/task-workspace/{task_id}/file?kind=readme`

这样既能展示文件内容，又不会暴露任意文件系统读权限。

### 12.3 任务链路展示

任务链路不应只是一串 ID，而应展示关系类型，例如：

| 关系 | 展示文案 |
| --- | --- |
| parent | 来源任务 |
| child | 拆分任务 |
| related | 关联任务 |
| blocked_by | 受阻于 |
| continues_from | 延续自 |

## 13. 冷归档机制

### 13.1 归档策略

任务进入终态并满足归档条件后，不仅要标记 `archived=true`，还应支持将整个任务工作区迁移到机械硬盘冷归档目录。

建议分三阶段：

| 阶段 | 说明 |
| --- | --- |
| hot | 活跃或刚完成，保留在 SSD |
| archiving | 正在迁移到 HDD |
| cold | 已迁移完成，SSD 只留索引与轻量镜像 |

### 13.2 冷归档脚本职责

需要提供单独脚本，例如：

```text
scripts/task_workspace_archive.py
```

该脚本负责：

1. 根据任务 ID 或任务代号定位工作区；
2. 校验任务已完成或允许归档；
3. 将目录迁移到机械硬盘目标目录；
4. 在原位置保留轻量 stub 或索引指针；
5. 更新数据库 `meta.workspace.archive_status` 与 `cold_archive_path`；
6. 追加 `ledger/archive.jsonl`；
7. 更新项目总索引和前端摘要数据源。

### 13.3 SSD 保留内容

归档后建议 SSD 仅保留：

| 保留内容 | 目的 |
| --- | --- |
| `task_index.json` 中的索引项 | 快速检索 |
| 任务轻量摘要 stub | 告知真实归档位置 |
| `live_status` 所需字段 | 前端仍可展示归档状态 |

## 14. 任务编号生成建议

考虑你强调“根据任务代号进行索引”，任务代号不应依赖 UUID。建议采用更直观的编号策略，例如：

```text
JJC-{YYYYMMDD}-{NNN}
```

示例：

```text
JJC-20260409-001
```

其中前缀可配置，日期用于人工识别，当日序号便于检索。UUID 继续保留作系统内部主键，但用户侧和文件系统以 `task_code` 为首要索引。

## 15. 推荐实施顺序

| 顺序 | 事项 |
| --- | --- |
| 1 | 扩展任务 `meta.workspace` 结构与 `to_dict()` 导出字段 |
| 2 | 实现工作区初始化器与任务代号生成器 |
| 3 | 在 `TaskService.create_task()` 中接入自动建目录与初始化文件 |
| 4 | 在 `transition_state` / `add_progress` / `update_todos` 中同步账本与快照更新 |
| 5 | 在 `dispatch_worker.py` 中接入交接摘要与上下文快照落盘 |
| 6 | 在 `kanban_update.py` 中补 JSON 模式兼容写入 |
| 7 | 在 `refresh_live_data.py` 中注入前端可见工作区摘要字段 |
| 8 | 在前端任务详情中新增工作区、Todo 链路和账本摘要展示 |
| 9 | 新增冷归档脚本与归档索引更新逻辑 |
| 10 | 完成联调与归档回读验证 |

## 16. 风险与注意事项

| 风险 | 说明 | 缓解建议 |
| --- | --- | --- |
| 双写不一致 | 数据库更新成功但文件写入失败，或反之 | 先实现幂等写入与补偿重试；关键路径记录错误到账本和日志 |
| 并发冲突 | 多 agent 同时更新同一任务文件 | 文件层使用原子写入与锁；数据库继续使用行级锁 |
| 任意路径暴露 | 前端如果直接读取绝对路径会产生安全风险 | 必须通过后端受控接口读取指定种类文件 |
| 冷归档断链 | 迁移后索引未更新导致前端找不到路径 | 迁移脚本必须在同一事务流程内更新索引和任务 meta |
| 账本过大 | 长期任务 JSONL 体积膨胀 | 支持分页读取、按月切分或滚动归档 |
| 刷新提示失真 | 实际该 `/new` 时没有标记 | 直接复用现有 context window warning/critical 判定 |

## 17. 结论

本方案不是简单增加几个文件，而是把任务流转从“数据库状态 + 临时上下文”升级为“数据库状态 + 任务工作区 + 追加式账本 + 可恢复上下文包”的组合机制。

这样做的直接收益有三点。第一，**agent 之间的交接将从口头描述变成真实文件接力**。第二，**在适时刷新上下文后，任务仍然可以稳定恢复**。第三，**任务归档将从单纯的状态标记变成完整工作区迁移到机械硬盘的冷数据管理流程**。

后续实现时，应优先保证**工作区初始化、账本追加、状态快照和前端摘要展示**四条主线先打通，然后再补冷归档迁移与更丰富的链路展示。
