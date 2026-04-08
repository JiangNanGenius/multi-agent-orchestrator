# 持久化聊天会话窗口改造记录

## 待办完成情况

- [x] 核实现有任务创建、活动流查询与前端恢复来源
- [x] 抽象通用持久化聊天会话组件 `PersistentAgentChat`
- [x] 将技能管理员入口从一次性窗口改为持久化聊天会话窗口
- [x] 将专家编组官入口从一次性治理弹窗改为持久化聊天会话窗口
- [x] 为前端 API 补充任务续聊追加消息方法 `taskAppendMessage`
- [x] 为 dashboard 后端补充 `/api/task-append-message` 续聊接口
- [x] 本地执行前端构建校验
- [x] 本地执行后端语法校验
- [x] 通过临时任务创建与活动流恢复脚本验证续聊链路

## 关键改动

### 前端

1. 新增 `edict/frontend/src/components/PersistentAgentChat.tsx`
   - 统一封装左侧会话列表、中间草稿/任务聊天区、右侧快捷意图与规则区。
   - 草稿态使用 `localStorage` 保存最近消息、未发送输入与当前选中会话，支持刷新恢复。
   - 已创建任务态通过 `taskId` 拉取 `taskActivity`，并定时刷新活动流，支持后台执行后恢复追踪。

2. 重写 `edict/frontend/src/components/SkillsConfig.tsx`
   - 保留本地技能名册与新增技能能力。
   - 将“技能管理员任务窗口”升级为“技能管理员会话窗口”。
   - 创建任务时继续复用 `templateId = skills_config_dialog` 与 `targetAgentId = admin_specialist`，因此历史任务也能按 Agent 分类恢复。

3. 重写 `edict/frontend/src/components/OfficialPanel.tsx`
   - 保留 Agent 贡献排行与详情面板。
   - 将专家编组官入口改为可展开的持久化聊天会话窗口。
   - 删除动作的说明区继续只展示“后续增设专家”，用于帮助用户正确描述治理对象。

4. 更新 `edict/frontend/src/api.ts`
   - 新增 `taskAppendMessage(taskId, agentId, message)`。

### 后端

1. 更新 `dashboard/server.py`
   - 新增 `handle_task_append_message(task_id, agent_id, message)`。
   - 新增 POST 路由 `/api/task-append-message`。
   - 将用户补充说明写入 `progress_log`，并补充 `agentLabel/state/org/updatedAt`，保证它能进入现有 `task-activity` 聚合结果。
   - 若任务未终态且提供了 `agentId`，会尝试唤醒对应 Agent，提醒其在原任务上下文中继续处理，而不是重新建单。

## 验证结果

### 构建与语法

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 前端 `pnpm build` | 通过 | 新组件与两处页面改造未触发 TypeScript / 打包错误 |
| 后端 `python3 -m py_compile dashboard/server.py` | 通过 | 新续聊接口未破坏服务端语法 |

### 续聊链路联调

通过临时验证脚本执行了以下流程：

1. 创建一个指向技能管理员的临时任务；
2. 调用 `handle_task_append_message` 追加一条“用户追加说明”；
3. 调用 `get_task_activity(task_id)` 读取聚合活动流；
4. 确认活动流中同时出现“提交任务”和“用户追加说明”；
5. 最终恢复原始 `tasks_source.json`，避免污染现有数据。

验证输出显示：

- 临时任务创建成功；
- 追加消息已写入活动流；
- 聚合活动流中能读取到 `用户追加说明：...`；
- 由于本地缺少 `openclaw` 命令，唤醒 Agent 时打印了告警，但不影响活动流写入与刷新恢复能力本身。

## 结论

本次改造已经满足以下目标：

1. **创建任务可能需要时间时，用户可以把任务挂在后台继续执行。**
2. **刷新网页后，草稿态可从本地恢复，已创建任务可从任务活动流恢复。**
3. **技能管理员与专家编组官都改为统一的会话式入口，而不是一次性弹窗。**
4. **后续可继续在既有任务上追加说明，避免重复建单。**

## 后续注意事项

1. 当前前端仍然对接 `dashboard/server.py`，不是 `edict/backend/app/api/tasks.py`。若后续整体切换到 FastAPI 后端，需要将本次续聊接口与活动流聚合逻辑同步迁移。
2. 本地联调中 `wake_agent` 依赖外部命令 `openclaw`。若部署环境未提供该命令，追加说明仍会成功写入活动流，但不会真正唤醒对应 Agent。
3. 若未来希望同一套窗口扩展到更多 Agent，会优先复用 `PersistentAgentChat` 组件，只需定义会话筛选规则、快捷意图与草稿摘要策略。
