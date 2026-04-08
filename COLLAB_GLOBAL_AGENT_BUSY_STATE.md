# 协同讨论全局专家忙碌状态机设计

## 背景

当前协同讨论系统已经具备**正式会议**与**闲聊**的会话内状态推进能力，但专家的占用关系仍然主要停留在单个会话内部。`court_discuss.py` 目前只维护会话级 `_sessions`，会话里记录了 `mode`、`stage`、`moderator_id`、`speaker_queue`、`minutes`、`trace` 等字段，却没有一个跨会话、跨页面、跨入口共享的**全局专家占用视图**。这意味着系统虽然知道某个会话正在推进，却还不知道该会话中的专家是否已经被其他会议、任务执行流或人工接管占用。

如果要满足“这种状态机应该全局有用，大家都知道谁在忙”的目标，就不能只把后台续会做成会议内部计时器，而应将其上升为**全局协作能力**。换言之，会议状态机负责描述“这场会开到哪里了”，而全局忙碌状态机负责描述“这些专家此刻被谁占着、是否还能被点名、是否需要让路”。

## 现状梳理

从现有代码结构看，协同讨论后端的核心入口集中在 `dashboard/court_discuss.py` 与 `dashboard/server.py`。前者负责会话创建、推进、结束和摘要生成，后者负责将这些能力暴露成 `/api/collab-discuss/*` 路由。前端会议室则集中在 `edict/frontend/src/components/CourtDiscussion.tsx`，通过 `api.ts` 中的 `collabDiscussStart`、`collabDiscussAdvance`、`collabDiscussConclude` 等接口完成会话级交互。

| 模块 | 现有能力 | 当前缺口 |
| --- | --- | --- |
| `court_discuss.py` | 维护单会话 `mode/stage/messages/minutes/trace` | 没有全局专家占用注册表，也没有抢占/让路/释放机制 |
| `server.py` | 暴露会话 `start/advance/list/session/conclude/destroy` 接口 | 没有“全局谁在忙”的专门接口 |
| `api.ts` | 定义协同讨论会话返回结构 | 只有会话字段，没有全局专家忙碌快照 |
| `CourtDiscussion.tsx` | 管理选人、主持人、发言推进 | 只能看到本会场成员，无法提前识别其他会话占用冲突 |
| `store.ts` | 已存在全局共享状态容器 | 目前未承载协同讨论专用的全局专家占用态 |

## 设计目标

本轮新增设计不应只服务于“后台续会”，而应抽象成可被所有协作入口复用的**全局专家忙碌状态机**。它至少要解决三类问题。第一，任何页面都能知道每位专家当前是否空闲、被谁占用、占用多久、是否允许插队。第二，会议在后台推进时，系统可以据此决定是继续点名、等待、跳过、还是请求让路。第三，将来无论是任务调度、会议、人工接管还是特殊巡检，都能复用同一套占用语义，而不必各自维护一套“忙碌”判断。

## 全局状态机抽象

建议将“专家在线状态”和“专家忙碌状态”拆成两个维度。前者继续沿用现有 `agents-status` 的 `running / idle / offline / unconfigured` 语义，它描述的是进程或节点是否可用。后者新增为**工作占用状态机**，描述该专家是否已经被某项协作活动占住。

> 在线状态回答的是“这个专家活着吗”；忙碌状态回答的是“这个专家现在归谁用”。

建议新增全局忙碌状态 `busy_state`，采用以下最小但可扩展的状态集合。

| `busy_state` | 含义 | 典型进入条件 | 典型退出条件 |
| --- | --- | --- | --- |
| `idle` | 空闲可调度 | 无占用记录或占用已释放 | 被会议/任务认领 |
| `reserved` | 已被预定但尚未真正发言或执行 | 会话创建成功、专家加入参会名单 | 进入 `active`，或取消后回到 `idle` |
| `active` | 正在被某个会议、任务或人工流程占用 | 当前轮发言、后台执行、人工接管 | 暂停转 `paused`，完成转 `cooldown/idle` |
| `paused` | 占用关系仍保留，但当前活动暂停 | 会议暂停、人工挂起 | 恢复转 `active`，释放转 `idle` |
| `yielding` | 正在向更高优先级活动让路 | 高优先级会议/任务借用同一专家 | 借用结束后回原会话 `active/paused` |
| `cooldown` | 刚刚结束，占用已松但短时间保留痕迹 | 会话结束或本轮执行完毕 | 冷却超时后回 `idle` |

这套状态机的关键不是状态名字本身，而是它把“预定”“进行中”“暂停保留”“临时让路”“刚释放”的协作语义区分开了。这样前端不只知道某人忙不忙，还能知道**为什么忙**、**忙到什么程度**、**是否值得等待**。

## 全局注册表数据模型

建议在 `court_discuss.py` 内新增模块级注册表，例如 `_agent_busy_registry: dict[str, dict[str, Any]] = {}`，用来记录每位专家最新的全局占用信息。由于该模块已经持有 `_sessions`，将全局忙碌注册表与会议会话暂时放在同一层是最低成本的落地方式；后续若需要跨进程持久化，再抽出到独立存储。

单个专家的全局忙碌记录建议包含下表字段。

| 字段 | 说明 |
| --- | --- |
| `agent_id` | 专家 ID |
| `busy_state` | 全局忙碌状态，取值见上表 |
| `owner_type` | 当前占用来源，如 `collab_session`、`task_run`、`manual_takeover` |
| `owner_id` | 占用实体 ID，例如 `session_id` 或 `task_id` |
| `owner_label` | 给前端直接展示的占用说明，例如“会议：发布方案评审” |
| `topic` | 关联主题或标题 |
| `priority` | 当前占用优先级，用于冲突仲裁 |
| `claim_mode` | 占用模式，如 `shared`、`exclusive` |
| `claimed_at` | 首次占用时间 |
| `last_heartbeat_at` | 最近活跃心跳时间 |
| `expires_at` | 预估释放时间或保底失效时间 |
| `yield_to_owner_id` | 若正在让路，记录借用方 |
| `return_owner_id` | 让路结束后要回归的原占用方 |
| `queue_depth` | 若该专家后续还有待处理请求，可附带队列长度 |
| `meta` | 可扩展元信息，如当前阶段、发言轮次、后台自动推进次数 |

## 会话侧需要新增的关联字段

为了让会话与全局注册表双向可追溯，建议在会话对象中补充一组与全局占用直接关联的字段。这样不仅列表页能恢复查看，后台推进器也能根据会话持有的占用信息进行续跑与释放。

| 会话字段 | 说明 |
| --- | --- |
| `run_state` | `running / paused / concluded`，用于后台续会 |
| `auto_run` | 是否允许后台自动续会 |
| `last_advanced_at` | 最近一次推进时间 |
| `next_run_at` | 计划下一次自动推进时间 |
| `auto_round_limit` | 自动推进上限 |
| `auto_round_count` | 已自动推进轮数 |
| `claimed_agents` | 当前会话已认领的专家列表 |
| `busy_snapshot` | 本会话视角下的专家忙碌快照 |
| `conflicted_agents` | 当前因冲突无法参与本轮的专家 |
| `yielded_agents` | 当前借入或借出的专家列表 |
| `activity_priority` | 当前会话优先级，用于抢占仲裁 |

## 状态迁移规则

建议采用“会话驱动认领、心跳续租、结束主动释放、超时被动回收”的模式。这样既能兼顾后台自动推进，也能兼顾页面关闭后的状态一致性。

| 触发事件 | 迁移规则 | 说明 |
| --- | --- | --- |
| 创建会议并选定专家 | `idle -> reserved` | 专家被会场预定，但未必已发言 |
| 会议正式推进到当前轮 | `reserved -> active` | 当前会话成为占用方 |
| 会议暂停 | `active -> paused` | 占用保留，避免别人误抢 |
| 高优先级会话临时借人 | `active -> yielding` | 原会场保留返回权 |
| 借用结束 | `yielding -> active/paused` | 回到原占用方的状态 |
| 会话结束或移除专家 | `active/reserved/paused -> cooldown` | 释放前保留短暂历史痕迹 |
| 冷却超时 | `cooldown -> idle` | 恢复可调度 |
| 心跳超时且无持有会话 | `reserved/active/paused -> idle` | 防止僵尸占用 |

## 冲突仲裁与让路规则

如果把忙碌状态机做成全局能力，最重要的不是“显示”，而是**冲突时如何裁决**。建议采用以下规则。

第一，默认情况下会议对专家采用**共享预定、独占发言**的策略。也就是说，专家被加入会场后可以进入 `reserved`，但真正到他本轮发言时才进入 `active`。这样既能告诉大家“他已经被这场会预定”，又不会过早把所有人都锁死。

第二，多个活动发生冲突时，由 `priority` 与 `claim_mode` 决定能否抢占。低优先级会场看到专家处于 `active` 且不可抢占时，应将其标记到 `conflicted_agents`，并在本轮中自动跳过或提示等待。高优先级会场若允许借用，则将原占用记录转为 `yielding`，并在借用结束后恢复原会话。

第三，主持人点名某位专家时，不应只看 `speaker_queue`，而应先读取该专家的全局忙碌状态。如果他当前被其他会话 `active` 占用，那么本次点名逻辑应自动改写为以下四种结果之一：立即发言、排队等待、请求让路、改点他人。这样会议才是“懂全局负载”的。

## 建议新增的后端辅助函数

建议在 `court_discuss.py` 中补充一组明确职责的辅助函数，以避免后续逻辑散落在 `create_session`、`advance_discussion`、`conclude_session` 中。

| 函数 | 作用 |
| --- | --- |
| `_ensure_agent_busy_record(agent_id)` | 初始化或补齐单个专家的全局忙碌记录 |
| `_get_agent_busy_snapshot(agent_ids)` | 读取一组专家的当前全局状态快照 |
| `_claim_agents_for_session(session, agent_ids, claim_state='reserved')` | 会话认领专家 |
| `_activate_speakers_for_round(session, speaker_ids)` | 当前轮将待发言专家切到 `active` |
| `_pause_session_claims(session)` | 会话暂停时批量切到 `paused` |
| `_resume_session_claims(session)` | 恢复会话时将可恢复专家切回 `reserved/active` |
| `_release_session_claims(session, cooldown_sec=30)` | 结束或销毁会话时释放占用 |
| `_yield_agent_between_sessions(agent_id, from_session, to_session)` | 高优先级会话借用专家 |
| `_cleanup_stale_claims()` | 清理无心跳或无主占用 |
| `_serialize_agent_busy_registry()` | 对外返回可供前端消费的全局忙碌视图 |

## 与现有接口的衔接方式

服务端现有路由已经具备 `start / advance / list / session / conclude / destroy` 的基础骨架，因此全局忙碌状态机可以在不破坏原接口语义的前提下增量接入。

建议的接口改动如下。

| 接口 | 改动建议 |
| --- | --- |
| `POST /api/collab-discuss/start` | 创建会话后自动认领专家，并返回 `busy_snapshot` |
| `POST /api/collab-discuss/advance` | 推进前后刷新忙碌状态、冲突列表与当前说话人占用 |
| `POST /api/collab-discuss/conclude` | 释放会话持有的专家占用 |
| `POST /api/collab-discuss/destroy` | 强制释放该会话的一切认领 |
| `GET /api/collab-discuss/list` | 返回每个会话的 `run_state`、`claimed_agents`、`conflicted_agents`、最近活动时间 |
| `GET /api/collab-discuss/session/{id}` | 返回完整 `busy_snapshot` 与冲突信息，支持恢复查看 |
| `GET /api/collab-discuss/agent-busy` | 新增，全局专家忙碌状态总览 |
| `POST /api/collab-discuss/pause` | 新增，暂停会议并保留占用 |
| `POST /api/collab-discuss/resume` | 新增，恢复会议并刷新认领 |
| `GET /api/collab-discuss/run-status` | 新增，返回后台推进器状态与下一次调度时间 |

## 前端展示建议

前端不应把全局忙碌状态机只放进会议室内部，否则“全局有用”的目标就落空了。建议至少做三层展示。

第一层是**专家选择层**。在 `CourtDiscussion.tsx` 的选人卡片上直接显示每个专家当前的全局徽标，例如“空闲”“已被预定”“正在他会发言”“暂停保留中”。这样用户在建会前就知道哪些人可用。

第二层是**会场推进层**。会话页顶部增加当前会场的 `busy_snapshot` 摘要，主持人点名区对冲突专家做显式禁用或提示，让系统在交互上呈现“这位专家现在正忙于某会议，可申请让路”。

第三层是**全局总览层**。可复用 `store.ts` 的共享状态容器新增 `collabAgentBusy` 数据源，并在会议列表页或系统总览页加入一个全局专家占用面板，让所有人都能直接看到谁忙、忙在哪、预计何时释放。

## 与现有 `agents-status` 的关系

现有 `api.ts` 中已经存在 `agentsStatus()`，其返回的 `status` 语义是 `running / idle / offline / unconfigured`。这套语义更偏“节点运行状况”，不宜直接塞入会议忙碌态，否则会把“在线但正忙”和“离线不可用”混在一起，导致前端判断混乱。

因此建议保留 `agents-status` 作为**健康度视图**，同时新增 `collab-discuss/agent-busy` 作为**占用度视图**。前端展示时可将两者合并：一个专家可能是“在线 + 忙碌”，也可能是“在线 + 空闲”，还可能是“离线 + 无法调度”。这种双通道设计比强行复用单一字段更稳。

## 推荐实施顺序

就当前项目状态而言，建议先完成后端数据模型与接口骨架，再推进前端展示。原因在于忙碌状态机是多个界面的共享事实源，如果先做前端，很容易出现页面有徽标但后端没有真实占用语义的问题。

| 顺序 | 实施内容 |
| --- | --- |
| 1 | 在 `court_discuss.py` 引入 `_agent_busy_registry` 与辅助函数 |
| 2 | 为会话结构新增 `run_state`、`claimed_agents`、`busy_snapshot` 等字段 |
| 3 | 在 `start / advance / conclude / destroy` 中接入认领、续租、释放流程 |
| 4 | 在 `server.py` 新增 `agent-busy / pause / resume / run-status` 路由 |
| 5 | 在 `api.ts` 扩展类型定义与请求函数 |
| 6 | 在 `CourtDiscussion.tsx` 与共享 `store.ts` 接入全局忙碌展示 |
| 7 | 最后补后台自动推进器，让其依赖同一套全局占用语义做调度 |

## 结论

这次需求的关键不是简单新增一个“忙/闲”标记，而是把协同讨论从“会话内编排”升级为“系统级资源治理”。因此，最合适的方向是引入一个**全局专家忙碌状态机**，与现有会议阶段状态机并行存在。前者负责资源占用、冲突仲裁与让路恢复，后者负责会议流程推进。只有这样，系统才能真正做到“大家都知道谁在忙”，并且在后台续会、主持人点名、会议恢复查看、跨会话冲突处理等场景下保持一致。
