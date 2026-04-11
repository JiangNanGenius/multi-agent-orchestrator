# legacy 入口收口交付摘要

本轮已完成 `kanban_update` 旧入口的兼容层收口，并将默认任务状态写回主链统一到 `task_db`。为保证历史自动化脚本和测试兼容，`scripts/kanban_update.py` 现已改为显式 **deprecated** 包装层；真正的旧实现迁移至 `scripts/legacy_kanban_update.py`，同时保留导入兼容能力，使测试中的 `TASKS_FILE` 等 monkeypatch 仍可直接生效。

| 项目 | 结果 |
| --- | --- |
| 默认写回主链 | 已统一为 `scripts/task_db.py` |
| legacy 入口定位 | `scripts/kanban_update.py` 已降级为兼容包装层 |
| 旧实现承载 | 新增 `scripts/legacy_kanban_update.py` |
| AgentOrchestrator 兼容说明 | 已补充 deprecated 与主链指引 |
| dashboard / archive / registry 文案 | 已同步切换到 `task_db` 主链口径 |
| 测试状态 | `44 passed` |
| Git 提交 | `9476df0` |
| Git 推送 | 已推送到 `origin/main` |

本次同时复核了活跃 SOUL、生成产物与规范文件中的旧入口引用。最终保留的 `kanban_update.py` 文本仅用于以下两类场景：其一是显式 **legacy compatibility** 说明；其二是旧实现文件或兼容示例中的历史命令展示。这些残留不再构成默认主链指引。

## 关键改动范围

| 路径范围 | 说明 |
| --- | --- |
| `scripts/kanban_update.py` | 重写为显式 deprecated 兼容包装层 |
| `scripts/legacy_kanban_update.py` | 承接旧 CLI 逻辑并补充弃用说明 |
| `dashboard/server.py` | 默认建议切换为 `task_db` 主链 |
| `docs/archive/.../logic_chain_memory_20260408.md` | 归档口径切换为 `task_db` 主链并注明 legacy 兼容 |
| `agentorchestrator/scripts/kanban_update_agentorchestrator.py` | 兼容层头部说明同步弃用定位 |
| `registry/generated/*` 与 `registry/specs/*` | 生成内容与规范统一更新，保留仅限兼容说明的引用 |
| `registry/soul_validation_report.json` | 随同步校验结果更新 |

## 验证结论

已完成回归测试与仓库扫描。`pytest -q` 结果为 **44 passed**。仓库中的 `kanban_update.py` 相关文本已从“默认写回入口”语义收口为“兼容层 / 旧示例 / 历史说明”语义；默认状态机、工作区与流转账本更新均已统一指向 `task_db`。

## 备份

已生成任务完成备份包：

`/home/ubuntu/task_backups/multi-agent-orchestrator_public_legacy_cleanup_20260411_182429.zip`

## 补充清理：`demo.gif` 残留收口

本轮继续清理了仓库中被识别为旧演示残留的 `docs/demo.gif`。处理方式不是仅删除二进制文件，而是把与之直接相关的展示引用、过期审计记录以及脚本输出命名一并收口，避免仓库后续再出现坏链或误导性表述。

| 项目 | 结果 |
| --- | --- |
| 残留资产 | 已删除 `docs/demo.gif` |
| 直接文档展示引用 | 已从 `docs/architecture-reflection-notes.md` 移除 |
| 录制脚本输出 | `scripts/record_demo.py` 默认输出改为 `docs/dashboard-tour.gif` |
| 截图说明文案 | `docs/screenshots/README.md` 已同步改为新输出文件名 |
| 历史审计记录 | 两份 `review_notes/link_audit_non_legacy*.json` 中的过期 `demo.gif` 记录已移除 |
| 剩余扫描结果 | 仓库内已无 `demo.gif` 文本引用 |

这次补充清理的目标，是将 `demo.gif` 从“文件层删除”提升到“语义层收口”。因此，凡是会继续暗示该文件仍为有效展示资产的文本，均已同步修正。
