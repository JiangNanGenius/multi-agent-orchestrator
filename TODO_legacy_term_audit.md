# 旧术语清理与统一命名重构 Todo

## 任务目标

根据上一轮全仓排查结果，系统性修改仓库中旧“三省六部”及“官员/奏折”相关残留命名，完成前后端主链路、脚本与文档的统一映射重构，并交付可直接使用的修改结果。

## 统一命名映射（当前执行稿）

| 旧命名 | 新命名 | 说明 |
| --- | --- | --- |
| `officials` | `agents` | 统一用于 Agent 总览数据集合、标签页与接口返回数组 |
| `OfficialInfo` | `AgentOverviewItem` | 用于前端 Agent 总览单项类型 |
| `OfficialsData` | `AgentOverviewData` | 用于前端 Agent 总览整体类型 |
| `officialsStats()` | `agentsOverview()` | 前端总览接口函数 |
| `/api/officials-stats` | `/api/agents-overview` | 后端总览接口路径 |
| `top_official` | `top_agent` | 总览顶层统计字段 |
| `selectedOfficial` | `selectedAgent` | 前端状态字段 |
| `loadOfficials` | `loadAgentsOverview` | 前端加载动作 |
| `OfficialPanel` | `AgentOverviewPanel` | 前端组件名 |
| `memorials` | `archives` | 结果归档集合与标签页 |
| `MemorialPanel` | `ArchivePanel` | 前端组件名 |
| `exportMemorial` | `exportArchive` | 前端导出动作 |
| `edicts` | `tasks` | 顶层任务标签页与任务集合语义 |
| `EdictBoard` | `TaskBoard` | 前端任务主面板组件名 |
| `isEdict` | `isTaskRecord` | 前端任务判断工具函数 |
| `participated_edicts` | `participated_tasks` | Agent 总览统计字段 |
| `official` | `owner` | 任务责任字段 |
| `imperial-edict` | `task-created` | 内部触发名 |

## Todo

- [x] 复核前端 `App.tsx`、`store.ts`、`api.ts` 与关键面板组件中的旧命名边界。
- [x] 复核后端任务模型与实时刷新脚本中 `official` / `officials` 相关主链路依赖。
- [x] 确定本轮统一命名映射执行稿，明确从 `officials/memorials/edicts` 切换到 `agents/archives/tasks`。
- [ ] 重构统计脚本 `scripts/sync_officials_stats.py`，同步调整输出文件名、顶层键与统计字段。
- [ ] 重构后端接口 `dashboard/server.py`，同步调整总览接口路径、任务责任字段与内部触发名。
- [ ] 重构实时刷新脚本 `scripts/refresh_live_data.py`，切换旧统计文件、旧任务字段与旧输出键名。
- [ ] 重构前端 API 类型 `edict/frontend/src/api.ts`，切换 Agent 总览类型、函数名与讨论接口字段名。
- [ ] 重构前端状态仓库 `edict/frontend/src/store.ts`，切换 `selectedOfficial`、`loadOfficials`、`isEdict` 与标签键。
- [ ] 重构前端主入口与组件文件，包括 `App.tsx`、`OfficialPanel.tsx`、`MemorialPanel.tsx`、`EdictBoard.tsx` 及相关导入。
- [ ] 同步清理样式、静态看板 `dashboard/dashboard.html`、启动脚本与相关文档中的旧命名残留。
- [ ] 执行构建或静态检查，确认重命名后的主链路可用。
- [ ] 记录修改结果与剩余风险，更新版本日志并形成最终交付说明。

## 当前已知主链路风险

| 类别 | 文件 | 风险说明 |
| --- | --- | --- |
| 后端数据模型 | `edict/backend/app/models/task.py` | 仍通过 `official` 输出责任角色，必须与前端 `owner` 字段同步切换。 |
| 实时汇总脚本 | `scripts/refresh_live_data.py` | 仍读取 `officials_stats.json` 并输出 `officials`、`officialCount`、`history[].official`。 |
| 前端 API | `edict/frontend/src/api.ts` | 仍定义 `OfficialInfo`、`OfficialsData` 与 `officialsStats()`。 |
| 前端状态 | `edict/frontend/src/store.ts` | 仍使用 `OfficialsData`、`selectedOfficial`、`loadOfficials`、`isEdict`。 |
| 前端主入口 | `edict/frontend/src/App.tsx` | 仍通过 `OfficialPanel`、`MemorialPanel`、`EdictBoard` 组织主界面。 |

## 版本日志

| 日期 | 变更 |
| --- | --- |
| 2026-04-08 | 创建旧术语残留排查待办清单，并记录当前已知重点残留。 |
| 2026-04-08 | 将待办清单升级为统一命名重构执行稿，明确新的内部命名映射与主链路改造顺序。 |
