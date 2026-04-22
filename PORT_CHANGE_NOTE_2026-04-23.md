# 正式前端开发默认端口调整记录（2026-04-23）

## 本次变更

本次将正式前端开发默认端口从 `5173` 调整为更冷门的 `35173`，以降低与常见 Vite 默认端口及本机其他开发服务发生冲突的概率。

## 已修改位置

| 文件 | 调整内容 |
| --- | --- |
| `agentorchestrator/frontend/vite.config.ts` | 将 `server.port` 从 `5173` 改为 `35173` |
| `install.sh` | 更新安装完成后的官方前端开发访问提示 |
| `docs/getting-started.md` | 更新开发联调默认访问地址 |
| `docs/remote-skills-quickstart.md` | 更新前端联调访问地址 |
| `docs/screenshots/README.md` | 更新截图与演示验证默认地址 |
| `REMOVAL_OFFICIAL_ONLY_NOTE_2026-04-13.md` | 更新当前官方链路说明中的默认前端开发端口 |
| `SQLITE_INTEGRATION_FIX_NOTE_2026-04-22.md` | 更新当前 SQLite 联调记录中的登录页访问地址 |

## 验证结果

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| Vite 开发服务启动 | 通过 | 日志显示本地地址为 `http://localhost:35173/` |
| 新端口监听 | 通过 | `0.0.0.0:35173` 已由 `node` 进程监听 |
| 页面访问 | 通过 | `http://127.0.0.1:35173` 可正常打开登录页 |
| 登录页元素 | 通过 | 可见 `Username`、`Password` 与 `Enter Workspace` |
| 旧端口默认入口 | 已退出默认链路 | 当前官方文档与配置已不再将 `5173` 作为默认开发入口 |

## 说明

`AUTH_LOGIN_RESTORE_NOTE_2026-04-12.md` 中仍保留 `5173` 表述，是因为该文件属于当日历史核验记录，用于保留当时问题定位与修复背景，不作为当前默认端口说明。
