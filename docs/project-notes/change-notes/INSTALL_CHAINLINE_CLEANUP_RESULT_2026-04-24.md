# 安装链路修复与仓库清理结果

## 结果摘要

本轮已按要求**删除 Windows 安装链路**，并将仓库公开安装口径收敛为 **Linux `install.sh` 单入口**。同时，已修复 Linux 安装脚本中的误导性提示、补齐安装前置引导，并同步清理中英文/日文公开文档与部署流程图中的双脚本描述。

## 已完成修改

| 项目 | 处理结果 |
| --- | --- |
| Windows 安装脚本 | 已删除 `install.ps1` |
| Windows 安装文档 | 已删除 `WINDOWS_INSTALL_CN.md`，避免失效入口继续暴露 |
| Linux 安装脚本 | 修复缺少 `openclaw.json` 时的报错文案，明确要求先执行 `openclaw init`；移除不存在的 `--sync-auth` 误导提示，改为直接重新运行 `./install.sh` |
| 入门文档 | 将安装说明改为 SQLite 本地链路；补充 `openclaw init` 前置步骤；修正认证补救命令与路径说明 |
| README / 流程图 | 清理 `install.ps1` 相关公开入口表述，并重新生成部署流程图 PNG |
| 端口收口 | 修复 `agentorchestrator.sh` 帮助文本中的旧端口 `8000`；修复 `agentorchestrator/frontend/vite.config.ts` 代理目标仍指向 `8000` 的遗留问题，现统一为 `38000` |

## 验证结论

| 检查项 | 结果 |
| --- | --- |
| `bash -n install.sh` | 通过 |
| `--sync-auth` 活跃引用 | 已从当前主链路移除 |
| 主链路公开文档中的 Windows 安装入口 | 已移除 |
| 前后端默认端口 | 前端 `35173`，后端 `38000` |
| Git 推送 | 已推送到 `origin/main` |

## Git 提交信息

| 项目 | 值 |
| --- | --- |
| 安装链路收口提交 | `664865c` |
| 提交信息 | `chore: remove windows install path and tighten linux setup` |

## 安装失败结论

当前用户所反馈的“Agent 安装失败”，至少有两类直接原因已经被明确处理：其一，脚本曾提示一个**并不存在的** `--sync-auth` 参数，会误导排障路径；其二，仓库此前仍保留 Windows 与 Linux 双入口口径，容易让 Agent 选择错误链路。除此之外，本轮验证还发现并修复了两个真实遗留项：`agentorchestrator.sh` 帮助文本仍显示旧端口 `8000`，以及前端开发代理仍指向 `8000`，这两个问题也已一并收口。

当前剩余的 `install.ps1` / `WINDOWS_INSTALL_CN.md` 引用仅存在于**历史归档或审计留痕文档**中，用于追溯，不作为当前公开默认安装口径。
