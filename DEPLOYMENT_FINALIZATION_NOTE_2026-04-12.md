# 正式部署版收口记录（2026-04-12）

本文档记录本次在合并 PR #7 之后，依据部署检查文档继续完成的正式部署版收口内容，供后续复核、上线与交接使用。

## 本轮收口范围

| 文件 | 处理内容 | 目的 |
|---|---|---|
| `agentorchestrator.service` | 调整为官方后端栈口径，移除错误的 `PIDFile` 依赖，改为 `Type=oneshot + RemainAfterExit=yes`，并将旧看板改为可选兼容模式说明 | 避免 systemd 继续把兼容层当成默认生产入口 |
| `install.sh` | 补充动态 Agent 发现失败时的明确告警，并在安装完成提示中强调默认只启动官方后端栈 | 让正式部署链路与安装出口文案一致 |
| `agentorchestrator/frontend/src/api.ts` | 修正头部说明，明确正式部署默认对接官方 API，而非旧看板 7891 | 防止后续维护误读前端接入方式 |
| `docs/screenshots/README.md` | 将截图流程改为先启动正式服务，再按需启用旧看板兼容模式 | 统一文档中的正式部署口径 |

## 关键判断

本轮收口确认，仓库当前正式部署口径应为：**默认启动官方后端栈并对外提供 API；旧版 dashboard 仅保留为兼容与排障用途，不再作为默认生产入口。**

## 最小验证结果

| 验证项 | 命令 | 结果 | 说明 |
|---|---|---|---|
| Shell 语法检查 | `bash -n install.sh agentorchestrator.sh` | 通过 | 启动脚本与安装脚本语法正常 |
| 前端类型检查 | `pnpm -s exec tsc --noEmit` | 通过 | 本轮文案与接口注释调整未引入前端类型错误 |
| systemd 单元校验 | `systemd-analyze verify /tmp/agentorchestrator_verify/agentorchestrator.service` | 通过 | 使用临时映射目录模拟 `/opt/agentorchestrator` 结构完成校验 |

## 仍需注意的事项

| 项目 | 说明 |
|---|---|
| 旧看板残留文档 | 仓库内仍有部分历史文档、Windows 安装说明与审计记录提到 `dashboard/server.py`；这些内容多为历史说明或兼容链路说明，未纳入本轮最小收口范围 |
| systemd 部署前提 | 正式安装时仍需确保部署目录为 `/opt/agentorchestrator`，并按服务文件要求设置 `agentorchestrator` 用户与写目录权限 |
| 兼容层启用方式 | 若验收、截图或排障仍需旧看板页面，需显式设置 `AGENTORCHESTRATOR_ENABLE_LEGACY_DASHBOARD=1` |

## 建议的下一步

| 优先级 | 建议 |
|---|---|
| P1 | 提交本轮收口改动并补充一次仓库级 README / getting-started 的正式部署说明统一清理 |
| P1 | 在真实目标机上执行一次 `./agentorchestrator.sh start` 与 `systemctl start agentorchestrator` 的联调验证 |
| P2 | 对历史文档中的 `dashboard/server.py` 默认入口表述做一次全集检索清理，避免后续维护混淆 |
