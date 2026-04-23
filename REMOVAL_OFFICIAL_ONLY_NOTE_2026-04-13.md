# 正式版-only 收口记录（2026-04-13）

本次收口的目标，是将仓库中所谓“兼容看板”相关实现、默认入口和活跃文档引用从正式交付链路中移除，仅保留正式版前后端与统一启动脚本作为官方使用方式。

| 类别 | 本轮处理结果 |
|---|---|
| 启动与服务 | 已将 `agentorchestrator.sh`、`agentorchestrator.service`、`install.sh`、`uninstall.sh` 收口为正式版-only 口径 |
| 辅助脚本 | 已将 `scripts/run_loop.sh`、`scripts/take_screenshots.py`、`scripts/record_demo.py` 默认入口统一到正式后端 / 正式前端链路 |
| 文档 | 已持续清理 `README_EN.md`、`README_JA.md`、`CONTRIBUTING.md`、Windows 安装说明文档、`docs/getting-started.md`、`docs/current_architecture_overview.md`、`docs/technical-architecture.md`、`docs/screenshots/README.md` 等活跃文档中的旧入口措辞 |
| 目录与测试 | 已删除兼容看板目录及其专属测试，并清理依赖已删除 `dashboard/server.py` 的失效测试 |
| 资源命名 | 已将 README 中仍带旧命名的流程图资源改为 `docs/readme-official-ui-flow.png` |

最小验证已执行，结果如下。

| 验证项 | 结果 |
|---|---|
| `bash -n agentorchestrator.sh install.sh uninstall.sh scripts/run_loop.sh` | 通过 |
| `python3 -m py_compile` 关键 Python 文件 | 通过 |
| `pnpm build`（`agentorchestrator/frontend`） | 通过；存在前端 chunk 大小提示，但不阻塞构建 |
| 活跃文件残留复扫 | 未发现必须继续清理的默认旧入口；仅剩设计/进度文档中的历史性说明 |

当前残留项主要集中在以下两类历史性文本中，暂不视为活跃默认入口残留：

| 文件 | 性质 |
|---|---|
| `docs/automation-task-management-design.md` | 用于描述历史演进与设计背景，保留“已移除旧实现”的上下文说明 |
| `docs/project-progress-log.md` | 用于记录项目演进日志，保留“已替代旧服务”的追溯性描述 |

结论上，仓库的**活跃运行链路**已经收口为正式版-only：官方服务入口为 `./agentorchestrator.sh start`，官方后端 API 默认地址为 `http://127.0.0.1:38000`，正式前端开发入口默认为 `http://127.0.0.1:35173`。

如需下一步继续推进，可直接执行以下后续动作之一：

| 后续动作 | 建议 |
|---|---|
| 提交并推送本轮变更 | 建议形成单独提交，方便审计“删除兼容看板”这一收口动作 |
| 补做远端 CI / 部署验证 | 建议在目标机器上按 systemd 链路实际启动一次 |
| 继续清理历史文档 | 若希望仓库中完全不再出现“旧看板”字样，可再单独处理设计文档与进度日志 |

