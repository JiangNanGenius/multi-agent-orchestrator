# SQLite 与 OpenClaw 对接修复及完整性检查记录（2026-04-22）

## 本次结论

本轮已继续参考 `cft0808/edict` 的 OpenClaw 对接方式，对当前项目完成二次审查、补充修复和完整性检查。核心修复点是 **SQLite 模式下 `outbox_events.id` 不能自增** 导致 `/api/tasks` 创建任务返回 500；现已修正模型定义与数据库初始化迁移逻辑，使历史 SQLite 表结构会在启动时自动纠正为可自增主键。

修复后，当前本地链路已能在 **SQLite 主数据库 + SQLite 事件总线** 模式下正常完成后端启动、登录页展示、任务创建、状态流转、进展追加和派发请求入队。由于当前沙箱未安装 `openclaw` CLI，真实 Agent 执行阶段会按预期进入 **Blocked** 并留下可诊断日志，而不是在任务创建阶段直接 500 崩溃。

## 参考仓库对照结论

参考仓库 `edict` 的核心链路仍然是：任务事件进入 outbox，经 relay 投递至事件总线，再由 dispatch worker 组装上下文后调用 OpenClaw CLI。[1] [2] 当前项目已经沿用了同一思路，但在切换到 SQLite 本地运行时，`OutboxEvent.id` 仍沿用不适合 SQLite 自增语义的主键定义，导致真实 API 创建任务时失败。这个问题不属于 OpenClaw 命令组装本身，而是 **SQLite 落地后的 outbox 表结构兼容缺口**。

| 对照项 | 参考仓库 `edict` | 当前项目修复后状态 |
| --- | --- | --- |
| 派发架构 | outbox + event bus + dispatch worker | 一致 |
| OpenClaw 调用方式 | worker 中异步调用 CLI | 一致 |
| 本地运行数据库 | 参考仓库围绕既有事件总线实现 | 当前项目已收敛到 SQLite 默认链路 |
| 任务创建稳定性 | 可正常写入 outbox | 已修复，SQLite 下恢复正常 |
| OpenClaw 缺失时行为 | 记录可操作错误 | 当前项目已能记录 `openclaw binary missing` |

## 实施的补充修复

本次新增修复集中在两个文件。

| 文件 | 修复内容 | 目的 |
| --- | --- | --- |
| `agentorchestrator/backend/app/models/outbox.py` | 将 `id` 改为对 SQLite 使用 `Integer` 变体，并补齐 SQLite 可用的部分索引与自增语义 | 解决 SQLite 下 `NOT NULL constraint failed: outbox_events.id` |
| `agentorchestrator/backend/app/db.py` | 在 `init_db()` 中加入 SQLite 历史 outbox 表结构自修复迁移 | 让已存在的错误表结构在启动时自动修正 |

## 完整性检查范围与结果

本轮完整性检查覆盖了自动化测试、脚本语法、前端构建、登录页、健康接口、配置接口、任务接口和派发链路。结果如下。

| 检查项 | 结果 | 备注 |
| --- | --- | --- |
| `pytest -q tests` | 通过 | 40 项测试全部通过 |
| `bash -n agentorchestrator.sh` | 通过 | 启动脚本语法正常 |
| `bash -n install.sh` | 通过 | Linux 安装脚本语法正常 |
| `npm run build` | 通过 | 前端可成功构建，存在 chunk size 警告但不阻塞构建 |
| `./agentorchestrator.sh start` | 通过 | API、Orchestrator、Dispatch、Outbox Relay 四个进程均正常拉起 |
| `/health` | 通过 | 返回 `status: ok` |
| `/api/admin/health/deep` | 通过 | 显示 `database: true`、`event_bus: true`、`event_bus_backend: sqlite` |
| `/api/admin/config` | 通过 | 返回主数据库与事件总线均为 SQLite 地址 |
| `/api/auth/status` | 通过 | 返回未登录状态，用户名为 `admin` |
| `http://127.0.0.1:35173` 登录页 | 通过 | 页面显示用户名、密码输入框与 `Enter Workspace` 按钮 |
| `POST /api/tasks` | 通过 | 任务创建已恢复，不再 500 |
| `POST /api/tasks/{id}/transition` | 通过 | 可正常流转到 `PlanCenter` |
| `POST /api/tasks/{id}/progress` | 通过 | 可追加进展记录 |
| `POST /api/tasks/{id}/dispatch` | 通过 | 可正常写入派发请求 |
| `GET /api/events/stream-info?topic=task.dispatch` | 通过 | 可返回事件流信息 |
| OpenClaw 缺失时错误处理 | 通过 | 任务进入 `Blocked`，日志记录 `openclaw binary missing` |

## 验证观察

在当前沙箱中，`openclaw` 二进制不存在，因此 dispatch worker 在执行阶段会将验证任务标记为 `Blocked`，并在日志中明确给出 `openclaw binary missing`。这说明当前系统已经从“任务创建阶段即崩溃”修复为“业务链路可继续推进，并在 OpenClaw 缺失时给出可诊断失败结果”。对本地联调而言，这个行为是合理且可接受的；若在你的实际环境中已安装 OpenClaw，则同一链路应继续进入真实 Agent 执行阶段。

## 尚未替你代做的部分

本轮没有替你提交或推送 GitHub，也没有在当前沙箱中安装新的 `openclaw` CLI。原因是当前用户指令聚焦于修复与完整性检查，而推送属于独立的重大变更动作，应在你确认后再执行。

## 相关产物

| 产物 | 说明 |
| --- | --- |
| `docs/project-notes/todos/TODO_SQLITE_OPENCLAW_INTEGRITY_2026-04-22.md` | 本轮待办及完成情况 |
| `review_notes/sqlite_integrity_check.py` | 可复用的本地完整性检查脚本 |
| 本文件 | 修复与验证收口记录 |

## References

[1]: file:///home/ubuntu/edict_ref/edict/backend/app/workers/dispatch_worker.py "edict dispatch_worker.py"
[2]: file:///home/ubuntu/edict_ref/edict/backend/app/services/task_service.py "edict task_service.py"
