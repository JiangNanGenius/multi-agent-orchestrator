# Backend Port Change Note · 2026-04-24

## 变更目标

将当前项目的**后端默认端口**从 `8000` 调整为更冷门的 `38000`，并确保统一启动脚本、服务文件、前端联调说明与活跃文档中的默认 API 入口保持一致。

## 本次修改范围

| 文件 | 调整内容 |
| --- | --- |
| `agentorchestrator/backend/app/config.py` | 将 `backend_port` 与 `port` 默认值由 `8000` 调整为 `38000` |
| `agentorchestrator.sh` | 将 `AGENTORCHESTRATOR_API_PORT` 的默认值由 `8000` 调整为 `38000` |
| `agentorchestrator.service` | 将 systemd 环境变量 `AGENTORCHESTRATOR_API_PORT` 调整为 `38000` |
| `install.sh` / `install.ps1` | 将默认 API 地址说明与联调提示更新为 `38000` |
| `docs/getting-started.md` | 将默认 API 地址、健康检查示例和前端代理说明更新为 `38000` |
| `docs/remote-skills-quickstart.md` | 将示例接口地址更新为 `localhost:38000` |
| `docs/screenshots/README.md` | 将官方默认 API 地址说明更新为 `38000` |
| `CONTRIBUTING.md` / `WINDOWS_INSTALL_CN.md` | 将默认后端访问地址与健康检查示例更新为 `38000` |
| `REMOVAL_OFFICIAL_ONLY_NOTE_2026-04-13.md` | 将当前正式版活跃运行链路说明中的默认 API 地址更新为 `38000` |
| `AUTH_LOGIN_RESTORE_NOTE_2026-04-12.md` | 将当前活跃接口核验地址更新为 `38000` |

## 验证结论

| 检查项 | 结果 |
| --- | --- |
| `./agentorchestrator.sh status` 输出的 API 地址 | `http://127.0.0.1:38000` |
| `ss -ltnp` 监听端口 | Backend API 监听于 `127.0.0.1:38000` |
| `curl http://127.0.0.1:38000/health` | 返回 `{"status":"ok","version":"2.0.1","engine":"multi-agent-orchestrator"}` |
| `curl http://127.0.0.1:8000/health` | 连接失败，说明旧端口不再作为当前默认入口 |
| 正式前端开发端口 | 仍为 `35173`，默认代理目标已更新为 `38000` |

## 备注

本次调整属于**默认端口收口**，目的是降低与常见本地服务的端口冲突概率。若部署环境需要自定义端口，仍可通过环境变量 `AGENTORCHESTRATOR_API_PORT` 覆盖默认值。
