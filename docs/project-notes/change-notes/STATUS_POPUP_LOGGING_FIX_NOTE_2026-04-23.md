# 状态提示与 Agent 排错日志修复记录（2026-04-23）

## 本轮目标

本轮修复聚焦两项能力：

1. 将原本仅支持 `ok/err` 的基础 toast 扩展为统一状态提示中心，补齐 `success / error / warning / info / loading` 五类提示能力，并保留旧调用兼容。
2. 为后端 API、Orchestrator、Dispatch、Outbox 四个核心进程补充**带容量上限的滚动排错日志**，并提供前端日志窗口，方便 Agent 在运行中快速查看最近错误上下文。

## 已完成改动

| 模块 | 改动 |
| --- | --- |
| `frontend/src/store.ts` | Toast 类型从 `ok/err` 扩展为多状态提示中心；新增 `dismissToast` / `clearToasts`；支持标题、sticky、时长和数量上限（最近 6 条）。 |
| `frontend/src/components/Toaster.tsx` | 重做提示组件，支持多状态图标、标题、内容和手动关闭。 |
| `frontend/src/index.css` | 新增多状态 toast 样式，并补充 Agent 排错日志窗口样式。 |
| `frontend/src/App.tsx` | 顶栏新增 Agent 排错日志入口；刷新操作接入 `loading → success / warning` 的多状态提示链路。 |
| `frontend/src/components/AgentLogModal.tsx` | 新增 Agent 排错日志窗口，支持目标进程切换、刷新和最近滚动日志查看。 |
| `frontend/src/api.ts` | 新增 `/api/admin/logs` 对接方法与类型定义。 |
| `backend/app/logging_utils.py` | 新增统一日志工具：每个核心进程独立写入 `*.agent.log`，单文件 512 KB，上限 4 个备份。 |
| `backend/app/main.py` | API 进程接入滚动排错日志。 |
| `backend/app/workers/orchestrator_worker.py` | Orchestrator 进程接入滚动排错日志。 |
| `backend/app/workers/dispatch_worker.py` | Dispatch 进程接入滚动排错日志。 |
| `backend/app/workers/outbox_relay.py` | Outbox 进程接入滚动排错日志。 |
| `backend/app/api/admin.py` | 新增 `/api/admin/logs`，返回目标进程最近日志、轮转元数据和备份信息。 |

## 本轮验证

### 构建与语法验证

| 检查项 | 结果 |
| --- | --- |
| `python3.11 -m compileall agentorchestrator/backend/app` | 通过 |
| `pnpm build`（frontend） | 通过 |

### 运行与接口验证

| 检查项 | 结果 |
| --- | --- |
| `./agentorchestrator.sh start` 后 `/health` | 返回 `ok` |
| `/api/admin/logs?target=dispatch&limit=40` | 可返回 dispatch 最近滚动日志与轮转元数据 |
| `/api/admin/logs?target=api&limit=20` | 可返回 api 最近滚动日志与轮转元数据 |
| `logs/*.agent.log*` | 已生成独立滚动排错日志文件 |

## 当前结论

当前项目已经具备：

1. **统一的多状态提示中心**，不再局限于简单成功/失败 toast。
2. **面向 Agent 排错的滚动日志保存机制**，且带有明确上限：每进程单文件 512 KB，保留 4 个备份文件。
3. **前端日志查看入口**，可直接查看 API / Orchestrator / Dispatch / Outbox 的最近滚动日志。

## 仍保留的说明

现有 `logs/api.log`、`logs/dispatch.log` 等原始进程日志仍保留，主要用于兼容现有启动脚本和传统排障习惯；本轮新增的 `*.agent.log` 才是面向 Agent 自主排错、具备滚动上限的正式日志链路。
