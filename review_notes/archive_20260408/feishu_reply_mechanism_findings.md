# 飞书群聊回复机制排查笔记

## 已确认入口

### 1. 运行时会话同步
- 文件：`scripts/sync_from_openclaw_runtime.py`
- 现状：
  - 会从 OpenClaw `sessions.json` 和 session jsonl 中抽取会话活动。
  - 对 assistant 文本仅做 `[[reply_to_current]]` 字样清理后展示到看板活动流。
  - `build_task()` 里只保留了 `agentId`、`sessionKey`、`sessionId`、`updatedAt`、`systemSent`、token 等基础信息。
- 缺口：
  - **没有把飞书群聊回复所需的 `message_id` / `thread_id` / `root_id` / `chat_id` 等上下文映射进 `sourceMeta`。**
  - **没有区分普通消息、群聊回帖、线程内回复、私聊直回等回复策略。**

### 2. 飞书通知通道
- 文件：`agentorchestrator/backend/app/channels/feishu.py`
- 现状：
  - 当前仅支持机器人 webhook 卡片发送。
  - `send(webhook, title, content, url=None)` 只构造 interactive card 并 POST 到 webhook。
- 缺口：
  - **不支持基于消息 ID 的原消息回复。**
  - **不支持 thread / root 语义，也没有 reply_in_thread / reply_to_message 等扩展参数。**
  - 更像“通知通道”，不是“会话回复通道”。

### 3. 看板前端
- 文件：
  - `dashboard/dashboard.html`
  - `agentorchestrator/frontend/src/components/SessionsPanel.tsx`
- 现状：
  - 已把 `feishu/direct` 标识展示为“飞书对话”。
  - 会过滤 `NO_REPLY`，并清理 `[[reply_to_current]]` 标记。
- 缺口：
  - **只做展示层兼容，没有暴露回复策略、回复目标、线程信息等诊断字段。**

### 4. 文本脱敏/清洗
- 文件：
  - `scripts/kanban_update.py`
  - `agentorchestrator/scripts/kanban_update_agentorchestrator.py`
- 现状：
  - 已清洗 `message_id|session_id|chat_id|open_id|user_id|tenant_key` 等系统元数据，避免直接出现在任务描述中。
- 含义：
  - 后续补强回复机制时，**需要把这些元数据保存在结构化字段里，而不是直接拼进展示文本**。

## 当前判断

本仓库里与“飞书群聊更好的回复机制”最相关的第一批改造点应集中在：

1. `scripts/sync_from_openclaw_runtime.py`
   - 扩展 `sourceMeta` / `replyMeta`
   - 从运行时会话来源中尽量保留飞书消息上下文
   - 为看板和后续治理提供标准化回复策略字段

2. `agentorchestrator/backend/app/channels/feishu.py`
   - 将现有 webhook 发送抽象升级为可扩展接口
   - 为后续接入“按消息回复 / 按线程回复 / 群聊回帖”预留参数模型

3. `dashboard/dashboard.html` 与 `agentorchestrator/frontend/src/components/SessionsPanel.tsx`
   - 在会话详情中补充 reply metadata 的展示与诊断能力

## 暂未在仓库中找到的实现
- 真实的飞书消息接收器/事件回调处理入口
- 基于 `message_id` 的飞书原消息回复 API 调用代码
- `reply_to_current` 被真正消费并转成飞书 reply 请求的明确服务端实现

## 结论
当前仓库更像是：
- **看板与任务治理侧已经“知道”存在 `[[reply_to_current]]` 这种回复意图；**
- **但真正的飞书群聊原对话回复能力并未在本仓库中完整落地。**

因此后续实施应采用：
1. 先在本仓库内建立统一的回复元数据模型与前后端可见性；
2. 再把飞书通道抽象升级为支持群聊回复语义；
3. 若真实回复动作依赖外部运行时，再通过接口/配置方式兼容，而不是把元数据塞回自然语言文本。
