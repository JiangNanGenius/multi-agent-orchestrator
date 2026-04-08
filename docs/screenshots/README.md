# 📸 截图说明

看板截图用于 README 和文档展示。请启动看板后按以下顺序截图并放置到本目录。

## 截图清单

| 文件名 | 内容 | 对应面板 |
|--------|------|---------|
| `01-kanban-main.png` | 任务看板总览 | 📋 任务看板 |
| `02-monitor.png` | 运行监控 | 🔭 运行监控 |
| `03-task-detail.png` | 任务流转详情（点击任务卡片展开） | 📋 任务看板 → 详情 |
| `04-model-config.png` | 模型配置面板 | ⚙️ 模型配置 |
| `05-skills-config.png` | 技能配置面板 | 🛠️ 技能配置 |
| `06-agents-overview.png` | Agent 总览（12 个节点） | 👥 Agent 总览 |
| `07-sessions.png` | 快速任务 / 会话 | 💬 快速任务 |
| `08-archives.png` | 结果归档 | 🗄️ 结果归档 |
| `09-templates.png` | 模板中心 | 📋 模板中心 |
| `10-morning-briefing.png` | AI 搜索引擎 | 🌐 AI 搜索引擎 |
| `11-ceremony.png` | 协同讨论 / 展示视图 | 协同讨论 / 展示视图 |

## 自动截图

```bash
# 确保看板服务器正在运行
python3 dashboard/server.py &

# 自动截取全部 11 张截图
python3 scripts/take_screenshots.py

# 录制 demo GIF（需要 ffmpeg）
python3 scripts/record_demo.py
```

## 建议

- 使用 **1920×1080** 或 **2560×1440** 分辨率
- 确保看板有足够的数据（至少 5+ 任务）
- AI 搜索引擎截图应优先展示搜索问题输入区、搜索专家忙闲状态与高级搜索设置入口
- 任务发布截图应体现“自动分配 / 手动多选专家”二选一交互，而不是旧的单选目标专家下拉
- 深色主题截图效果最佳
- 截图前刷新数据确保最新状态
