# 2026-04-08 旧术语与 Docker 留痕审计

本轮已基于全文检索复核仓库中的“三省六部”旧角色体系表述与 Docker 相关公开承诺，排除了 `review_notes/`、阶段性复盘文件与 `todo.md` 自身的命中项，保留需要实际整改的正式文件、脚本、示例、测试与演示数据。

| 类别 | 重点文件 | 主要问题 |
| --- | --- | --- |
| 正式文档 | `docs/remote-skills-guide.md`、`docs/remote-skills-quickstart.md`、`docs/getting-started.md`、`docs/wechat.md`、`docs/task-dispatch-architecture.md` | 仍存在“三省六部”表述、旧部门映射示例，以及 Docker 镜像/部署承诺 |
| 代码与配置 | `agentorchestrator/backend/app/__init__.py`、`agentorchestrator/backend/app/models/task.py`、`agentorchestrator/frontend/src/index.css`、`agentorchestrator/docker-compose.yml`、`docker-compose.yml` | 注释、字符串映射、样式类名说明和 Compose 文件头部仍保留旧表述或 Docker 使用暗示 |
| agents 文档 | `agents/groups/liubu.md`、`agents/*/SOUL.md` | 角色体系仍直接采用吏部、礼部、兵部、刑部、工部、户部等旧命名 |
| tests/examples | `tests/test_kanban.py`、`tests/test_file_lock.py`、`examples/*.md` | 对外可见样例与演示文本仍包含旧术语 |
| dashboard / frontend / scripts | `dashboard/dashboard.html`、`dashboard/court_discuss.py`、`agentorchestrator/frontend/src/store.ts`、`scripts/sync_from_openclaw_runtime.py`、`scripts/kanban_update.py`、`dashboard/server.py` | 展示文案、状态名、兼容映射说明中仍残留旧体系词汇 |
| docker 演示数据 | `docker/demo_data/*.json` | 大量旧角色命名、任务标题与 Docker Hub / Docker 镜像演示内容仍存在 |

当前判断如下。

第一，**旧术语残留并未只存在于 descriptor 文件**，而是已经扩散到正式文档、演示数据、测试样例、前端展示与后端注释中，因此需要分批处理，而不是只改一两个说明文件。

第二，**Docker 内容不仅存在于 README**，还存在于 Compose 文件、入门文档、架构文档以及 docker 演示数据中。若遵循“项目不提供也不维护 Docker 支持”的新边界，则至少需要把正式文档中的支持承诺改写为“不维护/仅历史遗留”，并评估是否保留 `docker/` 目录作为历史样例。

第三，`agentorchestrator/backend/app/models/task.py` 中的中文部门名映射很可能承担历史兼容职责，后续修改前需要区分“用户可见旧术语”与“兼容性内部键值”。如保留兼容映射，应改为代码注释明确说明其为历史兼容字段，而不是当前官方架构术语。

建议下一步按以下顺序推进。

| 顺序 | 动作 | 说明 |
| --- | --- | --- |
| 1 | 先清理正式文档与公开说明 | 风险最低，且直接满足无 Docker 承诺与架构命名统一目标 |
| 2 | 再清理 agents、examples、tests 与 dashboard 展示文本 | 保证演示和截图不再输出旧术语 |
| 3 | 最后处理代码中的兼容映射与 docker 演示数据 | 需要区分兼容字段、历史数据与真正外部支持边界 |

本文件作为 2026-04-08 的审计留痕，后续每完成一批清理后应同步回写 `todo.md`。
