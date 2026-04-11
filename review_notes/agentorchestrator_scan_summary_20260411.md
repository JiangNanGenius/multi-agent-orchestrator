# agentorchestrator 全仓残留扫描摘要

- 路径名命中数量：12
- 文本命中文件数量：121
- 文本命中总条目：1300

## 路径名命中

- `./agentorchestrator`
- `./agentorchestrator.service`
- `./agentorchestrator.sh`
- `./agentorchestrator/frontend/src/components/AgentOrchestratorBoard.tsx`
- `./agentorchestrator/scripts/kanban_update_agentorchestrator.py`
- `./task_agent_architecture.md`
- `./review_notes/audit_links_non_legacy.py`
- `./review_notes/task_full_scan_20260411.txt`
- `./review_notes/task_modernization_delivery_2026-04-10.md`
- `./review_notes/link_audit_non_legacy_20260411.json`
- `./review_notes/link_audit_non_legacy_postfix_20260411.json`
- `./review_notes/recheck_markdown_links_non_legacy.py`

## 部署 / 启动 / 脚本相关重点文件

### `DEPLOYMENT_FIX_AND_VERIFY_2026-04-11.md`
- L16: `| `install.sh` | 补齐 `expert_curator` 在硬编码 Agent 列表与工作区初始化链路中的覆盖；补上 `agentorchestrator/frontend/dist` 同步到 `dashboard/dist` 的部署步骤 | 避免 Linux 安装后角色缺失、看板继续使用旧前端 |`
- L18: `| `agentorchestrator/backend/app/api/agents.py` | 补齐并统一 `expert_curator` 的运行时元信息 | 避免接口层无法完整识别新角色 |`
- L29: `| `bash -n install.sh start.sh agentorchestrator.sh scripts/run_loop.sh` | 通过 |`
- L30: `| `python3.11 -m py_compile agentorchestrator/backend/app/api/agents.py dashboard/server.py scripts/sync_agent_config.py dashboard/court_discuss.py agentorchestrator/backend/app/config.py` | 通过 |`
- L46: `| `cd agentorchestrator/frontend && pnpm build` | 通过 |`
- L47: `| 构建产物 | 已生成 `agentorchestrator/frontend/dist` |`
- 另有 1 条命中未展开

### `DEPLOYMENT_PRECHECK_REPORT_2026-04-11.md`
- L10: `| [x] | 检查安装、启动、循环刷新与 systemd 入口 | 已定位并核对 `install.sh`、`start.sh`、`scripts/run_loop.sh`、`agentorchestrator.sh`、`agentorchestrator.service`。 |`
- L114: `[8]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator.sh "agentorchestrator.sh"`
- L115: `[9]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator.service "agentorchestrator.service"`
- L117: `[11]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/config.py "agentorchestrator/backend/app/config.py"`
- L118: `[12]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/alembic.ini "agentorchestrator/alembic.ini"`
- L27: `| 本地统一启动 | 可用 | 低 | `agentorchestrator.sh` 负责看板服务与刷新循环的 PID 管理、日志管理和健康检查，适合作为常驻启动入口。[8] |`
- 另有 11 条命中未展开

### `README.md`
- L120: `| [cft0808/agentorchestrator](https://github.com/cft0808/agentorchestrator) | 当前公开版整理所参考的上游之一 [6] |`
- L140: `[5]: ./agentorchestrator/E2E_task_workspace_validation_result_2026-04-09.json "E2E 联调验证结果"`
- L141: `[6]: https://github.com/cft0808/agentorchestrator "cft0808/agentorchestrator"`

### `TODO_manus_2026-04-09.md`
- L114: `- [ ] 扩展 `agentorchestrator/backend/app/services/task_workspace.py` 的通知与风险确认元数据`
- L115: `- [ ] 扩展 `agentorchestrator/backend/app/services/task_service.py` 的通知与风险确认写回逻辑`
- L116: `- [ ] 检查并同步 `agentorchestrator/backend/app/models/task.py` 的序列化字段`
- L117: `- [ ] 检查并同步 `agentorchestrator/frontend/src/api.ts` 的类型定义`
- L120: `- [ ] 更新 `agentorchestrator/scripts/task_watchdog.py`，加入 `/new` 监督与通知生成逻辑`

### `docs/archive/root_legacy_notes/TODO_legacy_term_audit.md`
- L23: `| `tasks` | `tasks` | 顶层任务标签页与任务集合语义 |`
- L26: `| `participated_tasks` | `participated_tasks` | Agent 总览统计字段 |`
- L28: `| `imperial-agentorchestrator` | `task-created` | 内部触发名 |`
- L34: `- [x] 确定本轮统一命名映射执行稿，明确从 `officials/memorials/tasks` 切换到 `agents/archives/tasks`。`
- L38: `- [ ] 重构前端 API 类型 `agentorchestrator/frontend/src/api.ts`，切换 Agent 总览类型、函数名与讨论接口字段名。`
- L39: `- [ ] 重构前端状态仓库 `agentorchestrator/frontend/src/store.ts`，切换 `selectedOfficial`、`loadOfficials`、`isAgentOrchestrator` 与标签键。`
- 另有 4 条命中未展开

### `agentorchestrator.service`
- L14: `User=agentorchestrator`
- L15: `Group=agentorchestrator`
- L16: `WorkingDirectory=/opt/agentorchestrator`
- L17: `ExecStart=/opt/agentorchestrator/agentorchestrator.sh start`
- L18: `ExecStop=/opt/agentorchestrator/agentorchestrator.sh stop`
- L19: `ExecReload=/opt/agentorchestrator/agentorchestrator.sh restart`
- 另有 5 条命中未展开

### `agentorchestrator.sh`
- L4: `# 用法: ./agentorchestrator.sh {start|stop|status|restart|logs}`

### `agentorchestrator/backend/app/services/event_bus.py`
- L105: `await self.redis.publish(f"agentorchestrator:pubsub:{topic}", json.dumps(event, ensure_ascii=False))`
- L22: `log = logging.getLogger("agentorchestrator.event_bus")`
- L257: `pipe.publish(f"agentorchestrator:pubsub:{topic}", json.dumps(event_data, ensure_ascii=False))`
- L43: `STREAM_PREFIX = "agentorchestrator:stream:"`

### `agentorchestrator/backend/app/services/task_service.py`
- L41: `log = logging.getLogger("agentorchestrator.task_service")`

### `agentorchestrator/frontend/node_modules/typescript/lib/lib.dom.d.ts`
- L1476: `prtaskedEvents?: PointerEvent[];`
- L24108: `* The **`getPrtaskedEvents()`** method of the PointerEvent interface returns a sequence of `PointerEvent` instances that are estimated future pointer positions.`
- L24110: `* [MDN Reference](https://developer.mozilla.org/docs/Web/API/PointerEvent/getPrtaskedEvents)`
- L24112: `getPrtaskedEvents(): PointerEvent[];`

### `agentorchestrator/scripts/kanban_update_agentorchestrator.py`
- L212: `task_state = _STATE_TO_TASK.get(state, state.lower())`
- L236: `task_state = _STATE_TO_TASK.get(new_state, new_state.lower())`
- L238: `# 需要先通过 legacy_id 查找 agentorchestrator task_id`
- L241: `'new_state': task_state,`

### `review_notes/archive_20260408/legacy_terms_and_docker_audit_20260408.md`
- L11: `| dashboard / frontend / scripts | `dashboard/dashboard.html`、`dashboard/court_discuss.py`、`agentorchestrator/frontend/src/store.ts`、`scripts/sync_from_openclaw_runtime.py`、`scripts/kanban_update.py`、`dashboard/server.py` | 展示文案、状态名`
- L20: `第三，`agentorchestrator/backend/app/models/task.py` 中的中文部门名映射很可能承担历史兼容职责，后续修改前需要区分“用户可见旧术语”与“兼容性内部键值”。如保留兼容映射，应改为代码注释明确说明其为历史兼容字段，而不是当前官方架构术语。`
- L8: `| 代码与配置 | `agentorchestrator/backend/app/__init__.py`、`agentorchestrator/backend/app/models/task.py`、`agentorchestrator/frontend/src/index.css`、`agentorchestrator/docker-compose.yml`、`docker-compose.yml` | 注释、字符串映射、样式类名说明和 Compose 文件头部仍保留旧表述或 Docker 使用暗示 |`

### `scripts/kanban_update.py`
- L317: `# 从 task.py 动态加载（如果 agentorchestrator 目录存在），否则使用内置 fallback`
- L318: `_task_task_path = _BASE / "agentorchestrator" / "backend" / "app" / "models" / "task.py"`
- L319: `if _task_task_path.exists():`
- L322: `# Fallback：当 agentorchestrator 目录不存在时使用内置定义（必须与 task.py 保持一致）`
- L49: `"""从 agentorchestrator/backend 源码解析状态转换表，无需 import（避免 SQLAlchemy 依赖）。"""`
- L50: `task_py = _BASE / "agentorchestrator" / "backend" / "app" / "models" / "task.py"`
- 另有 3 条命中未展开

### `scripts/record_demo.py`
- L48: `cards = page.locator('.agentorchestrator-card')`

### `scripts/refresh_watcher.py`
- L11: `- systemd: 参见 agentorchestrator.service`
- L12: `- docker-compose: 参见 agentorchestrator/docker-compose.yml`

### `scripts/run_loop.sh`
- L12: `LOG="/tmp/task_refresh.log"`
- L13: `PIDFILE="/tmp/task_refresh.pid"`

### `scripts/run_refresh_check.py`
- L5: `base = pathlib.Path('/home/ubuntu/task_review_20260407')`

### `scripts/take_screenshots.py`
- L152: `cards = page.locator('.agentorchestrator-card')`
- L251: `'name': 'agentorchestrator_token',`
- L49: `localStorage.setItem('agentorchestrator_locale', 'zh');`

### `todo.md`
- L14: `| 前端构建产物治理 | 已完成 | `agentorchestrator/frontend/dist/` 已改为不纳管 |`
- L58: `- [x] 重构 `scripts/`、`agentorchestrator/scripts/`、`migration/` 中残留的旧组织名、旧状态与旧 agent ID`

## 首页 README 命中

- L120: `| [cft0808/agentorchestrator](https://github.com/cft0808/agentorchestrator) | 当前公开版整理所参考的上游之一 [6] |`
- L140: `[5]: ./agentorchestrator/E2E_task_workspace_validation_result_2026-04-09.json "E2E 联调验证结果"`
- L141: `[6]: https://github.com/cft0808/agentorchestrator "cft0808/agentorchestrator"`
