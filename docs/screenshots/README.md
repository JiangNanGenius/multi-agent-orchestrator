# 截图说明

截图资源用于 README 与项目文档展示。当前仓库仅保留**正式版**链路，因此截图前应先按 `docs/opencode-ai-deployment-runbook.md` 或正式安装主链路完成部署，再启动官方后端栈，并使用后端同源托管的正式前端页面进行访问；仓库已不再维护任何旧界面模式。

## 截图清单

| 文件名 | 内容 | 对应面板 |
|---|---|---|
| `01-kanban-main.png` | 任务看板总览 | 任务看板 |
| `02-monitor.png` | 运行监控 | 运行监控 |
| `03-task-detail.png` | 任务流转详情（点击任务卡片展开） | 任务看板 → 详情 |
| `04-model-config.png` | 模型配置面板 | 模型配置 |
| `05-skills-config.png` | 技能配置面板 | 技能配置 |
| `06-official-overview.png` | Agent 管理工作台总览 | Agent 管理工作台 |
| `07-sessions.png` | 协作会话 / 快速任务 | 协作会议室 |
| `08-memorials.png` | 记忆中心 | 记忆中心 |
| `09-templates.png` | 模板中心 | 模板中心 |
| `10-morning-briefing.png` | AI 搜索引擎 | AI 搜索引擎 |
| `11-ceremony.png` | 协同讨论 / 展示视图 | 协同讨论 / 展示视图 |

## 自动截图

```bash
# 1) 启动正式后端服务栈（会同源托管正式前端）
./agentorchestrator.sh start

# 2) 在正式页面环境下自动截取全部 11 张截图
python3 scripts/take_screenshots.py

# 3) 录制演示 GIF（默认输出 `docs/official-ui-tour.gif`，需要 ffmpeg）
python3 scripts/record_demo.py
```

> 默认正式访问地址为 `http://127.0.0.1:38000/`。截图与演示脚本应统一面向后端同源托管的正式前端页面进行验证；若交给 AI 自动完成部署与验收，优先使用 `docs/opencode-ai-deployment-runbook.md` 作为执行说明。

## 建议

| 项目 | 建议 |
|---|---|
| 分辨率 | 使用 **1920×1080** 或 **2560×1440** |
| 数据量 | 确保系统中至少有 5 个以上任务，避免画面过空 |
| AI 搜索引擎 | 优先展示搜索问题输入区、搜索专家忙闲状态与高级搜索设置入口 |
| Agent 管理工作台 | 突出角色编组、职责摘要与调基入口 |
| 记忆中心 | 优先展示长期记忆文件、时间线入口与编辑区 |
| 任务发布 | 体现“自动分配 / 手动多选专家”二选一交互 |
| 视觉样式 | 深色主题截图效果最佳 |
| 截图前准备 | 截图前先刷新数据，确保展示最新状态 |
