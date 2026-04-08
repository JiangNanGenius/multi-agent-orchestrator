# 2026-04-08 最终收尾记录

## 本次完成内容

已完成三大模块统一为“发起后台任务 → 运行中可见 → 完成后沉淀结果历史”的交互改造收口，并完成公开界面脱敏、README 预览图更新、前端构建产物去纳管、最终提交与一次 GitHub 推送。

## 关键收口

1. 任务发布、技能管理、全网搜索的入口文案已收口。
2. 任务详情流程改为按任务实际流转动态生成。
3. 全网搜索最近记录已具备保留、复用查询、查看结果、查看任务、删除记录能力。
4. 前端 `edict/frontend/dist/` 已改为不纳管，避免构建产物不一致再次阻塞推送。
5. 公开界面中的“审计专家”等旧展示口径已统一为“合规专家”；`admin_specialist` 仅保留为内部技术 ID 与兼容映射。

## 推送信息

- Commit: `c796385`
- Branch: `main`
- 实际推送目标以当前 Git 远端配置为准，请以 `git remote -v` 输出复核。

## 备份信息

- 初次完整备份：`/home/ubuntu/backups/multi-agent-orchestrator_public_full_20260408-134241.tar.gz`
- Final 备份：`/home/ubuntu/backups/multi-agent-orchestrator_public_final_20260408-140133.tar.gz`
- Final 校验：`/home/ubuntu/backups/multi-agent-orchestrator_public_final_20260408-140133.tar.gz.sha256`

## Todo 收口补记

- 已核对仓库内 `todo.md` 与 `docs/current_todo_20260408.md` 两份待办文件。
- 已将重复待办合并到根目录 `todo.md`，并按当前仓库事实补打勾本轮已完成但未及时更新的事项。
- `docs/current_todo_20260408.md` 现改为归档说明，不再作为继续维护的主 Todo。
- 后续新增事项、阶段进度与完成勾选统一只维护根目录 `todo.md`。

## P0 命名迁移复核补记

- 已复核 `agents.json`，当前全部 agent ID、工作区路径与允许调用链均已切换为 `control_center`、`plan_center`、`review_center`、`dispatch_center` 与各 specialist 体系。
- 已将 `agents/groups/sansheng.md`、`agents/groups/liubu.md` 分别重命名为 `agents/groups/centers.md`、`agents/groups/specialists.md`，并手工清理组级文档内仍直接暴露的旧组织称呼。
- 已将统计同步脚本入口从 `scripts/sync_officials_stats.py` 重命名为 `scripts/sync_agents_overview.py`，并同步修正 `run_loop.sh`、`install.sh`、`install.ps1`、`README.md`、`README_EN.md` 与 `docs/wechat-article.md` 中的调用。
- 已移除仅作为旧入口兼容包装的 `scripts/fetch_morning_news.py`。
- 已对 `agents/`、`scripts/`、`edict/scripts/`、`tests/`、`install.*` 与 `agents.json` 做二次扫描；当前源码/测试主链范围内，旧 agent ID、旧组织名与旧文件名引用已基本清零。
- 仍保留旧术语的位置主要在历史审计、差异分析与阶段性交付文档中，这些文件仅用于追溯，不作为当前公开默认实现口径。

## P1 / P2 文档治理与体验收口补记

- 已新增 `docs/current_capability_boundary.md` 作为长期治理入口，用于统一记录当前真实能力边界，以及归档、交付、自动化巡检三者之间的边界说明。
- 已同步修正 `README.md` 中与真实实现不一致的“自动归档”强表述，并补入长期治理入口链接，避免后续上下文恢复再次误判能力范围。
- 已复核 `SkillsConfig.tsx`、`TemplatePanel.tsx`、`WebSearchPanel.tsx` 等高中文占比模块；当前公开口径已基本一致，并移除了技能详情弹窗中对内部文件路径的直接展示。
- 已按目录将旧阶段性文件集中归档，避免继续与主线文档混放：根目录旧清单已归入 `docs/archive/root_legacy_notes/`，阶段性恢复/审计文档已归入 `docs/archive/stage_notes_20260407_20260408/`，审计扫描与复核输出已归入 `review_notes/archive_20260408/`。
- 当前 P1 文档治理主线与 P2 前端口径收口已基本完成；剩余待完成事项主要为最后一轮构建、联调与公开界面回归验证。
