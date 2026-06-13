# 修改记录概览

## 后端

### compat.py
- 新增 `POST /api/agent-search` — 异步搜索启动
- 新增 `GET /api/agent-search` — 搜索状态轮询
- 新增 `GET /api/memory-files` — OpenClaw 记忆文件列表
- 新增 `GET /api/memory-file` — 读取记忆文件内容
- 新增 `_run_search`, `_run_opening`, `_run_advance` 后台线程函数
- 新增 `_inject_openclaw_skills` 扫描工作区 skill
- 新增 `_discover_skills_in_dir` skill 扫描工具
- 新增 `_scan_mem_dir` 记忆文件扫描工具
- 修改 `GET /api/global-agent-busy` — 查询DB+协作会话+搜索状态
- 修改 `POST /api/collab-discuss/start` — 异步后台线程
- 修改 `POST /api/collab-discuss/advance` — 异步+忙跳过
- 修改 `POST /api/collab-discuss/pause` — 持久化暂停
- 修改 `POST /api/collab-discuss/resume` — 持久化恢复
- 修改 `POST /api/collab-discuss/conclude` — 标记完成+发送`/new`清除会话
- 修改 `POST /api/collab-discuss/destroy` — 删除文件+`/new`清除
- 修改 `GET /api/agent-config` — 增加 OpenClaw skill 扫描
- 修改 `POST /api/create-task` — COMPAT 默认 creator
- 修改 `POST /api/tasks/{id}/delete` — 返回 `ok:true`
- 添加 `import logging`, `import time`, 模块级 `logger`

### dispatch_worker.py
- `_auto_advance_state`：original_state 检查，Agent自己改了状态则跳过
- `_build_soul_context`：5000+字符→1行身份提示
- dispatch_center→Doing→无specialist→Done

### orchestrator_worker.py
- `_on_task_completed`：dispatch 回 control_center

## 前端

### MeetingDiscussion.tsx (原名 CourtDiscussion.tsx)
- 3种讨论模式选择器（自动/正式协作/轻松聊天）
- 自动暂停：5分钟无操作
- Agent名称 deptMeta 解析
- 三栏布局高度链路修复
- 成员卡片单行
- 参会成员合并
- 删除关键设置入口
- 删除3条描述文案
- "会商主舞台"→"会议室状态"

### AgentOrchestratorBoard.tsx
- 左右面板等高
- 任务态势→任务状态
- 删除归档描述

### WebSearchPanel.tsx
- 异步搜索+轮询
- Markdown渲染
- 全部主题→自动
- 气泡包裹

### MemoryCenterPanel.tsx (重写)
- 对接OpenClaw记忆API
- 长期记忆/日期记忆分区
- 日期选择+提示

### OfficialPanel.tsx
- 排除main Agent
- 删除面板描述，`/new`清除会议上下文

### MonitorPanel.tsx
- 当前能力→当前模型
- duty-card flex布局

### TaskModal.tsx
- 看门狗状态从任务状态推导

### App.tsx
- 系统态势→系统状态
- Court→Meeting
- 删除品牌副标题

### index.css
- 高度链路：app-shell, workspace-frame, workspace-main, workspace-content, workspace-panel-shell
- flex:1, min-height:0, overflow:hidden
- duty-card 三段式
- Agent标记格式搜索特殊状态卡片压缩

### api.ts
- 新增：agentSearch, agentSearchStatus, memoryFiles, memoryFile
- CollabRunStatus 类型扩展

## Agent配置
- 12个Agent全部通过 openclaw agent CLI 初始化
- BOOTSTRAP.md 全部删除
- IDENTITY.md 补全3个
- 13个空 MEMORY.md 创建
- 中文命名：陈枢、蓝策、沈阅、谢传、文墨、林数、方程、何规、安澜、管宁、罗辑、苏寻

## Skills
- OpenClaw 工作区扫描发现17个skill
- 全局skill置顶
- main排除

## 部署
- agentorchestrator.sh 使用venv Python
- 打包到公开下载目录（具体服务器路径已在公开版中脱敏）
