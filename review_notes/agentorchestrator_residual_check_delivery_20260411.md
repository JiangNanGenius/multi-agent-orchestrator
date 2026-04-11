# agentorchestrator 全仓残留核查结论（2026-04-11）

本次按“**不把首页允许保留的两个引用当作问题豁免的唯一判断依据，而是检查整个仓库所有文件**”的标准，对仓库进行了全量扫描，并额外复核了用户指出的截图资源 `docs/screenshots/01-kanban-main.png`。

## 结论

当前仓库**远未达到**“除了首页两个引用外，已经没有任何 `agentorchestrator` 痕迹”的状态。即使把首页 README 中允许保留的两个引用先单独拿开，仓库里仍然存在大量 `agentorchestrator` 残留，覆盖**目录名、文件名、部署入口、脚本变量、代码常量、审计记录与历史文档**等多个层面。

下表给出本次扫描的关键统计。

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 路径名命中数量 | 12 | 包括目录名、文件名中直接包含 `agentorchestrator` 的对象 |
| 文本命中文件数量 | 121 | 表示至少 121 个文件中仍出现 `agentorchestrator` 字样 |
| 文本命中总条目 | 1300 | 包括代码、脚本、部署文档、历史记录与审计产物 |
| 首页 README 命中 | 是 | 首页确有保留引用，但绝不是唯一残留来源 |
| 截图文件 `docs/screenshots/01-kanban-main.png` | 已刷新 | 源文件内容已核对并完成重编码刷新，当前文件画面不是旧版“三省六部” |

## 仍然存在的高优先级残留

从发布、部署和运行角度看，以下几类问题最值得优先处理，因为它们不只是“历史注释”，而是会直接出现在路径、启动入口或运维说明中。

| 类别 | 典型位置 | 当前情况 |
| --- | --- | --- |
| 顶层目录 / 文件名 | `./agentorchestrator`、`./agentorchestrator.service`、`./agentorchestrator.sh`、`./task_agent_architecture.md` | 仍直接使用 `agentorchestrator` 命名 |
| 部署与启动入口 | `agentorchestrator.service`、`agentorchestrator.sh` | systemd 用户、组、工作目录、启动脚本路径仍指向 `agentorchestrator` |
| 部署说明文档 | `DEPLOYMENT_FIX_AND_VERIFY_2026-04-11.md`、`DEPLOYMENT_PRECHECK_REPORT_2026-04-11.md` | 多处把 `agentorchestrator` 目录当作正式部署路径或构建来源 |
| 代码与脚本依赖 | `scripts/kanban_update.py`、`scripts/refresh_watcher.py`、`scripts/run_loop.sh`、`scripts/take_screenshots.py` | 仍引用 `agentorchestrator` 目录、类名、cookie 名、日志文件名等 |
| 仓库内部代码路径 | `agentorchestrator/backend/...`、`agentorchestrator/frontend/...`、`agentorchestrator/scripts/...` | 路径层级本身仍是 `agentorchestrator` |
| 历史 / 审计 / TODO 文档 | `todo.md`、`TODO_manus_2026-04-09.md`、`docs/archive/...`、`review_notes/...` | 仍大量保留 `agentorchestrator` 字样 |

## 直接证据摘录

下面列出本轮核查中最能说明“并非只剩首页两个引用”的代表性证据。

| 文件 | 证据 | 含义 |
| --- | --- | --- |
| `agentorchestrator.service` | `User=agentorchestrator` / `Group=agentorchestrator` / `WorkingDirectory=/opt/agentorchestrator` | 部署与运行身份、目录路径仍是 `agentorchestrator` |
| `agentorchestrator.sh` | `./agentorchestrator.sh {start|stop|status|restart|logs}` | 顶层启动脚本名称仍是 `agentorchestrator` |
| `scripts/run_loop.sh` | `/tmp/task_refresh.log` / `/tmp/task_refresh.pid` | 后台循环脚本仍使用 `agentorchestrator` 命名的运行时文件 |
| `scripts/kanban_update.py` | `_task_task_path = _BASE / "agentorchestrator" / "backend" / ...` | 代码逻辑仍默认依赖 `agentorchestrator` 目录结构 |
| `scripts/refresh_watcher.py` | `systemd: 参见 agentorchestrator.service` | 运维脚本说明仍指向 `agentorchestrator` 入口 |
| `DEPLOYMENT_PRECHECK_REPORT_2026-04-11.md` | `agentorchestrator.sh`、`agentorchestrator.service`、`agentorchestrator/backend/app/config.py` | 部署检查文档仍将 `agentorchestrator` 作为正式对象 |
| `DEPLOYMENT_FIX_AND_VERIFY_2026-04-11.md` | `cd agentorchestrator/frontend && pnpm build` | 前端构建路径仍明确写为 `agentorchestrator/frontend` |
| `README.md` | `https://github.com/cft0808/agentorchestrator`、`./agentorchestrator/...` | 首页确实存在保留引用，但不是唯一残留 |

## 关于用户指出的截图问题

对 `docs/screenshots/01-kanban-main.png` 的复核结果如下。

| 项目 | 结果 |
| --- | --- |
| 当前源文件画面 | 新版“任务中枢 / 当前任务态势”界面 |
| 分辨率 | `3840 x 2160` |
| 重编码前 SHA-256 | `01954a0a020ef06ad677ba8a1520826dbb055550095fdf7452721ca596246032` |
| 重编码后 SHA-256 | `21242ae196411b2f0819cecef54814bd31027aed696f7066babaf566ac483fbb` |
| 判断 | 当前仓库源文件不是旧版大图；更像是外部展示层或缓存命中了旧资源 |

本次已经对该 PNG 做了**无损重编码刷新**，目的不是改变画面，而是改变文件指纹，降低大图继续命中旧缓存的概率。

## 本轮判断

如果你的验收标准是：

> 除首页允许保留的两个引用外，仓库中任何地方——包括部署目录、文件名、脚本、配置、历史文档——都不应再出现 `agentorchestrator`。

那么当前结论只能是：**未通过**。

而且问题不是零星残留，而是仍有一整套以 `agentorchestrator` 为核心命名的目录与部署入口存在，因此若要真正达到该标准，下一轮工作需要从“文本清理”升级为“**目录、脚本入口、部署路径和历史产物治理**”。

## 建议的下一步

| 优先级 | 建议动作 | 原因 |
| --- | --- | --- |
| P0 | 明确首页允许保留的“两个引用”具体是哪两处 | 目前 README 实际命中不止两行，需先定义豁免边界 |
| P0 | 处理 `agentorchestrator` 顶层目录、`agentorchestrator.sh`、`agentorchestrator.service` | 这些是最显性的命名残留，也是部署入口 |
| P1 | 清理部署报告、预检文档、TODO 与 review_notes 中的 `agentorchestrator` | 否则仓库搜索结果仍会被大量污染 |
| P1 | 清理脚本中的 `agentorchestrator` 日志名、PID 名、cookie 名、CSS 类名与路径依赖 | 避免运行时继续暴露旧命名 |
| P2 | 复查截图与静态资源发布链路缓存 | 防止用户看到大图与仓库源文件不一致 |

## 参考附件

本结论对应的原始支撑材料见下列文件：

1. `review_notes/task_scan_summary_20260411.md`
2. `review_notes/task_full_scan_20260411.txt`
3. `review_notes/kanban_screenshot_issue_note_20260411.md`

