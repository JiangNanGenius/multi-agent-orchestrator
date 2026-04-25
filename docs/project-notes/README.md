# 项目留痕与阶段文档索引

为减少仓库根目录中 `.md` 文件过多导致的杂乱感，当前已将**阶段性变更说明、设计留痕和专项 Todo** 统一收口到 `docs/project-notes/`。

## 目录说明

| 目录 | 用途 |
| --- | --- |
| `change-notes/` | 阶段修复记录、安装链路收口记录、端口与 SQLite 调整说明、部署复验说明，以及开发模式归档说明等 |
| `design-notes/` | 架构草案、设计讨论、会话与面板改造留痕、任务账本设计说明等 |
| `todos/` | 某一轮专项改造的阶段 Todo，区别于仓库根目录的统一主 `todo.md` |

## 根目录保留原则

仓库根目录目前只保留**公开入口或长期有效的核心文档**，例如 `README.md`、多语言 README、`CONTRIBUTING.md`、`SECURITY.md`、`ROADMAP.md`、`PUBLIC_REPO_METADATA.md` 与主 `todo.md`；而当前给 AI / opencode 使用的正式部署执行说明，则放在 `docs/opencode-ai-deployment-runbook.md`。

> 如果某份 Markdown 主要用于说明某次修复、某轮排障或某个临时设计决策，而不是项目长期入口文档，应优先放入 `docs/project-notes/`，而不是继续堆在仓库根目录。

## 当前维护约定

| 类型 | 维护约定 |
| --- | --- |
| 项目主入口 | 放在仓库根目录，保持名称稳定 |
| 当前统一待办 | 继续使用根目录 `todo.md` |
| 阶段修复记录 | 放入 `docs/project-notes/change-notes/` |
| 设计与评审留痕 | 放入 `docs/project-notes/design-notes/` |
| 专项 Todo | 放入 `docs/project-notes/todos/` |
