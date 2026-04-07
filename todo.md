# 项目全局 TODO（逐项勾选版）

本文档用于把当前仓库中的事项改为**一件一件可执行、可勾选、可持续更新**的 Markdown 清单。当前主线分为三部分：第一部分是**此前已收口的看板认证与访问控制改造**；第二部分是**已实施完成的飞书群聊回复机制改造**；第三部分是**本轮复核 newly found 的公开说明、服务描述文件、脚本注释、agents 角色文档、tests 与示例数据中的旧术语残留清理**。后续我会继续按照这份清单推进，并在每完成一项后直接打勾。

## 一、当前总览

### 1.1 主线状态

- [x] 看板认证与访问控制改造完成闭环
- [x] 飞书群聊回复机制改造完成闭环
- [x] 项目文档与项目痕迹已补齐到仓库
- [ ] 公开说明、描述文件与脚本注释中的旧术语残留清理完成闭环
- [x] 当前已改造内容完成构建与基础回归验证

### 1.2 当前执行原则

- [x] 已将前序未完成事项与本轮新增事项合并到同一份全局 TODO
- [x] 已把 TODO 改为逐项可勾选格式
- [ ] 后续新增任务必须继续追加到本文件并逐项勾选
- [x] 认证主线完成后已再次执行完整联调与状态更新

## 二、主线 A：看板认证与访问控制改造

> 这一主线是**当前仍未完成**的后续重点，下面每一项都会按完成情况逐项打勾。

### 2.1 需求目标

- [x] 默认用户名为 `admin`
- [x] 默认密码为 `admin`
- [x] 首次登录后必须修改密码
- [x] 首次登录时允许修改用户名，但不强制
- [x] 用户名、密码哈希与首登状态写入静态文件
- [x] 删除认证文件后恢复默认 `admin/admin`
- [x] 未登录时不可访问看板主功能
- [x] 刷新页面后仍保持登录态
- [x] README 与相关说明文件同步更新认证机制说明

### 2.2 后端实现

#### `dashboard/auth.py`

- [x] 重构认证配置结构，支持用户名、密码哈希、强制改密标记与默认回退
- [x] 增加首次默认配置加载逻辑
- [x] 增加认证文件原子写入能力
- [x] 增加登录用户信息写入 token payload 的逻辑
- [x] 验证删除认证文件后的默认恢复行为

#### `dashboard/server.py`

- [x] 增加 `/api/auth/login`
- [x] 增加 `/api/auth/status`
- [x] 增加 `/api/auth/first-change`
- [x] 增加 `/api/auth/change-password`
- [x] 增加 `/api/auth/change-username`
- [x] 增加 `/api/auth/logout`
- [x] 调整路径鉴权逻辑，保护 API 与看板入口
- [x] 页面入口支持登录壳层与认证状态检查
- [x] 验证未登录时无法直接访问主看板

### 2.3 前端实现

#### `edict/frontend/src/api.ts`

- [x] 增加认证相关接口定义
- [x] 增加认证相关类型定义

#### `edict/frontend/src/store.ts`

- [x] 确认认证状态未放入全局 store，而由 `App.tsx` 本地管理，避免污染现有任务轮询状态
- [x] 确认 store 仅在登录成功且无需首登改密时启动轮询

#### `edict/frontend/src/App.tsx`

- [x] 在应用根部增加登录壳层
- [x] 增加首登改密拦截逻辑
- [x] 增加认证状态初始化逻辑
- [x] 增加账号设置弹窗与退出登录逻辑

#### 认证界面组件

- [x] 已以内联组件形式提供登录页组件
- [x] 已以内联组件形式提供首次登录改密组件
- [x] 已以内联组件形式提供账号设置组件
- [x] 已将设置入口接入现有界面

#### `edict/frontend/src/index.css`

- [x] 增补登录页样式
- [x] 增补首次改密样式
- [x] 增补账号设置样式
- [x] 保持整体视觉风格与现有看板一致

### 2.4 认证验收场景

- [x] 无认证文件首次启动时，可用 `admin/admin` 登录
- [x] 首次登录后会被强制进入改密流程
- [x] 首次登录只改密码不改用户名时允许进入系统
- [x] 首次登录继续使用默认密码时被拒绝
- [x] 删除认证文件后恢复默认账号并重新进入首登流程
- [x] 未登录访问主看板时会跳转登录页或被拦截
- [x] 登录后刷新页面仍保留登录态
- [x] 登录后修改用户名能同步写回文件与界面
- [x] 登录后修改密码立即生效

## 三、主线 B：飞书群聊更好的回复机制

> 这一主线已完成主体实现，因此已按实际状态打勾保留，方便后续复查。

### 3.1 需求与协议

- [x] 将 `reply_to_current`、`NO_REPLY` 等意图提升为结构化字段
- [x] 尽量保留 `message_id`、`thread_id`、`root_id`、`chat_id` 等回复上下文
- [x] 支持“禁止回复、普通发送、回复当前消息、沿线程回复、回复根消息”等标准策略
- [x] 在会话详情中展示回复策略、目标消息、线程上下文与降级信息
- [x] 过滤系统元数据，避免泄露到摘要与标题展示
- [x] 保持对历史文本标记数据的兼容
- [x] 在 README 与执行留痕中说明本轮改造内容与限制

### 3.2 服务端与脚本

#### `scripts/sync_from_openclaw_runtime.py`

- [x] 抽取并标准化 `replyMeta`
- [x] 抽取并标准化 `replyPolicy`
- [x] 抽取并标准化回复目标字段
- [x] 兼容从运行时来源中提取飞书消息上下文
- [x] 解析 assistant 文本中的 `[[reply_to_current]]`
- [x] 解析 assistant 文本中的 `NO_REPLY`
- [x] 保持旧展示数据兼容

#### `edict/backend/app/channels/base.py`

- [x] 扩展通道发送接口，允许携带 reply meta / strategy
- [x] 保持旧调用方式兼容

#### `edict/backend/app/channels/feishu.py`

- [x] 增加群聊回复策略参数支持
- [x] 增加结构化 reply metadata 兼容
- [x] 增加回复策略摘要展示能力
- [x] 保持 webhook 通知发送兼容

#### 服务调用链

- [x] 检查 send 签名扩展后的调用兼容性
- [x] 补齐 reply metadata 透传入口
- [x] 统一 `policy`、`target_message_id`、`thread_id`、`root_id`、`fallback_mode` 等字段命名

### 3.3 前端与看板联动

#### React 看板

- [x] 在 `edict/frontend/src/api.ts` 中增加 reply metadata 类型定义
- [x] 在 `edict/frontend/src/components/SessionsPanel.tsx` 中展示 reply policy
- [x] 在 `edict/frontend/src/components/SessionsPanel.tsx` 中展示 reply target
- [x] 在 `edict/frontend/src/components/SessionsPanel.tsx` 中展示回复上下文与降级信息
- [x] 保持摘要逻辑继续过滤 `NO_REPLY` 与清理 `[[...]]`
- [x] 在 reply metadata 缺失时提供容错展示

#### 原生静态看板

- [x] 在 `dashboard/dashboard.html` 中展示 reply metadata 诊断信息
- [x] 在会话卡片中展示回复策略摘要
- [x] 在详情弹窗中展示回复目标
- [x] 在详情弹窗中展示字段来源与降级信息
- [x] 保持旧摘要行为兼容

### 3.4 飞书回复机制验收

- [x] assistant 文本含 `[[reply_to_current]]` 时，摘要不显示标记
- [x] assistant 文本含 `[[reply_to_current]]` 时，详情可见结构化策略或解析结果
- [x] assistant 文本以 `NO_REPLY` 开头时，摘要会过滤该回复
- [x] assistant 文本以 `NO_REPLY` 开头时，详情可见禁止自动回复语义
- [x] 飞书来源会话存在 `message_id/thread_id/root_id` 时，详情可展示对应目标
- [x] 飞书来源缺少完整线程信息时，系统可显示降级策略而不报错
- [x] 非飞书来源会话不会错误展示飞书回复区块
- [x] 旧 webhook 调用链未因通道接口升级而中断

## 四、文档、留痕与版本记录

- [x] 在 `README.md` 中追加版本日志
- [x] 在 `README.md` 中记录飞书群聊回复机制改造说明
- [x] 保留排查笔记 `review_notes/feishu_reply_mechanism_findings.md`
- [x] 保留全局 TODO 作为统一执行基线
- [x] 已同步更新 `README_EN.md`
- [x] 已同步更新 `README_JA.md`
- [x] 在仓库中留下本轮任务完成痕迹，避免重复核对

### 4.1 本轮复核新增的无兼容全量命名体系重构

- [x] 复核 `todo.md` 与历史留痕，确认此前“已清零”判断过早
- [x] 清理 `edict.service` 中的旧项目描述与服务模板注释
- [x] 清理 `.github/CODEOWNERS` 中残留的旧术语注释
- [x] 清理 `Dockerfile` 顶部残留的旧术语注释
- [ ] 清理 `edict.sh`、`start.sh`、`uninstall.sh`、`install.ps1`、`install.sh`、`scripts/run_loop.sh`、`requirements.txt` 等脚本或依赖文件中的旧术语
  - [x] 已清理 `edict.sh` 头部标题与状态输出中的“三省六部”旧表述
  - [x] 已清理 `start.sh` 头部标题与启动横幅中的“三省六部”旧表述
  - [x] 已清理 `uninstall.sh` 对外可见标题、提示语与完成横幅中的“三省六部”旧表述
  - [x] 已清理 `install.sh` 顶部命名、工作协议文案与初始化示例数据中的旧表述
  - [x] 已清理 `install.ps1` 顶部命名、工作协议文案、注册提示语与完成横幅中的旧表述
  - [x] 已清理 `scripts/run_loop.sh` 顶部命名、日志文件名与启动横幅中的旧表述
  - [x] 已清理 `requirements.txt` 中 AgentRec 依赖注释的旧角色体系表述
- [x] 将 `README.md`、`README_EN.md`、`README_JA.md` 中的 Docker 使用与维护承诺改为“非维护范围”（后续将按新决策继续移除 Docker 相关内容）
- [x] 删除仓库中的 Docker 相关文件、目录与演示数据，并移除公开说明中的 Docker 入口
- [x] 锁定新的全量命名体系映射表，最终采用：`control_center`、`plan_center`、`review_center`、`dispatch_center`、`code_specialist`、`deploy_specialist`、`data_specialist`、`docs_specialist`、`audit_specialist`、`admin_specialist`、`search_specialist`
- [ ] 重构 `agents.json` 中的全部 agent ID、工作目录、agentDir 与 allowAgents 调用链
- [ ] 重命名 `agents/` 目录结构与各角色 SOUL 文档中的 agent ID、职责关系与调用说明
- [ ] 重构 `scripts/`、`edict/scripts/`、`migration/` 中的旧状态流转、旧组织名与旧 agent ID
- [ ] 重构 `dashboard/`、`frontend/` 与编译产物中的旧 agent ID、角色标签、会话解析规则，并将原早朝页面改造成 `web_search` 全网搜索页
  - [x] 已开始调整 `edict/frontend/src/api.ts` 与 `edict/frontend/src/store.ts`，将页签触发与全局状态由 `morning` 语义逐步切换到 `web_search` / `search` 口径
  - [x] 已建立 `edict/frontend/src/i18n.ts`，并在 `store.ts` 中接入全局 locale、双语页签标签与状态文案映射
  - [x] 已完成 `App.tsx` 顶层入口双语化，覆盖登录、首次改密、账号设置、页签导航、头部状态与语言切换入口
  - [x] 已完成 `EdictBoard.tsx`、`MonitorPanel.tsx`、`OfficialPanel.tsx`、`AutomationPanel.tsx`、`SessionsPanel.tsx`、`MemorialPanel.tsx` 与 `ConfirmDialog.tsx` 的主流程英文切换
  - [x] 已多次执行 `edict/frontend` 构建校验，当前 `pnpm build` 通过
  - [ ] 继续清理 `api.ts`、`store.ts`、组件层与页面文案中的 `morning` / `Morning` 类型名、接口名与显示文案残留
  - [x] 已完成 `ModelConfig.tsx`、`CourtDiscussion.tsx` 与 `CourtCeremony.tsx` 的英文切换，并保持现有交互与讨论流程可用
  - [ ] 继续补齐 `SkillsConfig.tsx`、`TemplatePanel.tsx`、`WebSearchPanel.tsx` 等高中文占比模块的英文切换
- [ ] 重构 `docs/`、`examples/`、`README*`、`WINDOWS_INSTALL_CN.md` 中的旧 ID、旧路径与旧架构叙事，并统一调整为优先推荐 AI 部署的文档口径
  - [x] 已将 `README.md` 的部署主叙事进一步收紧为“AI 先评估环境，再选择最小执行路径”，并将 `install.sh` / `install.ps1` 明确降级为条件性次选工具
  - [x] 已同步收紧 `README_EN.md` 中 AI-assisted deployment 与初始化脚本的优先级表述
  - [x] 已同步收紧 `README_JA.md` 中 AI 支援デプロイ的导线说明与版本日志
  - [x] 已确认 `WINDOWS_INSTALL_CN.md` 当前已符合“先由 AI 判断，再决定是否运行 install.ps1”的口径
  - [x] 已新增统一的 README 项目流程图源文件 `docs/readme-workflow.mmd` 与渲染图 `docs/readme-workflow.png`
  - [x] 已在 `README.md`、`README_EN.md`、`README_JA.md` 中插入统一流程图，三语文档的主链路说明已对齐
  - [x] 已在三语 README 中补充“常见问题 / Troubleshooting / よくある問題”与公开维护节奏建议，增强公开访客、部署执行者与后续维护者的使用入口
  - [x] 已补强公开仓库协作、最小验证动作与脱敏发布检查说明，可直接支撑本轮脱敏推送
- [ ] 重构 `tests/` 中直接对外可见或会影响演示输出的旧 ID 与旧术语样例
- [ ] 全仓二次扫描并确认旧 agent ID、旧术语与残余 Docker 引用已基本清零

## 五、构建与回归验证

- [x] 前端构建脚本检查完成
- [x] 执行 `npm run build` 并通过
- [x] 执行 Python 语法检查并通过
- [x] 执行运行时同步脚本回归验证并通过
- [x] 认证主线开发完成后再次执行全量回归
- [x] 认证主线开发完成后补充针对登录流程的交互验证

## 六、接下来按顺序继续做的事项

> 复核后确认：任务已从“公开说明旧术语清理”升级为**无兼容的全量命名体系重构**；同时用户已明确要求**删除 Docker 相关内容**、**agent ID 也要改**，并确认**新命名体系已锁定并包含 `search_specialist` / `web_search` 功能重定义**。接下来按下面顺序**一件一件做完再打勾**。

1. [x] 复核 `todo.md` 与历史留痕，确认此前范围判断已经升级
2. [x] 删除仓库中的 Docker 相关文件与公开入口
3. [x] 整理阶段检查点与全仓命名耦合审计摘要，避免长上下文丢信息
4. [x] 锁定完整新命名体系映射表（`control_center`、`plan_center`、`review_center`、`dispatch_center`、`code_specialist`、`deploy_specialist`、`data_specialist`、`docs_specialist`、`audit_specialist`、`admin_specialist`、`search_specialist`）
5. [ ] 重构 `agents.json` 中的全部 agent ID、路径与调用链
6. [ ] 重命名 `agents/` 目录结构并同步修改 SOUL 与组说明
7. [ ] 重构 `scripts/`、`edict/scripts/`、`migration/` 中的旧状态、旧组织名与旧 ID
8. [ ] 重构 `dashboard/`、`frontend/` 与必要的编译产物，并将原早朝页面改造成 `web_search` 全网搜索页
   - [x] 已接入全局 locale 与本地持久化，并完成看板主入口及核心主面板的首轮英文切换闭环
   - [x] 已完成 `ModelConfig.tsx`、`CourtDiscussion.tsx` 与 `CourtCeremony.tsx` 的双语化接入
   - [x] 已再次执行前端构建回归，当前 `pnpm build` 通过
   - [x] 已确认前端源码中不再存在 `morning` / `Morning` 文本残留
   - [ ] 继续确认 `SkillsConfig.tsx`、`TemplatePanel.tsx`、`WebSearchPanel.tsx` 的最终英文切换完成度，并在必要时补最后一轮界面文案
   - [x] 已确认当前前端构建通过，可在此基础上继续补齐剩余高中文占比模块
9. [ ] 重构 `docs/`、`examples/`、`README*`、安装文档中的旧路径与旧架构叙事，并统一调整为优先推荐 AI 部署的文档口径
   - [x] 已确认安装脚本保留，但所有公开文档与部署说明必须以 AI 部署为第一推荐路径
   - [x] 已完成 `README.md`、`README_EN.md`、`README_JA.md` 的本轮主入口收紧，并确认 `WINDOWS_INSTALL_CN.md` 已符合当前部署策略
10. [ ] 重构 `tests/` 中的旧 ID 与旧术语样例
11. [ ] 全仓二次扫描并确认旧 agent ID、旧术语与残余 Docker 引用已基本清零
12. [ ] 执行回归检查、补写留痕并输出最终交付说明

## 七、执行记录

- [x] 2026-04-08：建立覆盖前序事项与本轮事项的全局 TODO
- [x] 2026-04-08：完成飞书群聊回复机制现状排查
- [x] 2026-04-08：完成运行时与通道层 replyMeta / policy 改造
- [x] 2026-04-08：完成 React 看板与静态看板的飞书回复上下文展示
- [x] 2026-04-08：完成前端构建、Python 语法与同步脚本回归验证
- [x] 2026-04-08：将 todo 重构为逐项可勾选版
- [x] 2026-04-08：完成 `dashboard/auth.py` 烟雾测试并确认默认回退、首登改密与静态认证文件行为有效
- [x] 2026-04-08：完成 `dashboard/server.py` 认证接口复核，已确认登录、状态、首登改密、改密、改名与退出接口已落地
- [x] 2026-04-08：完成前端认证壳层复核，已确认 `api.ts`、`App.tsx` 与 `index.css` 中的登录、首登改密、账号设置与样式已落地
- [x] 2026-04-08：完成认证联调，已验证默认登录、首登改密、改名、改密、退出登录后的受保护接口拦截，并恢复默认 `admin/admin` 基线
- [x] 2026-04-08：完成本轮逐项勾选收口，已同步更新 TODO 与 README 并准备交付说明
- [x] 2026-04-08：完成 `README_EN.md` 与 `README_JA.md` 同步更新
- [x] 2026-04-08：根据用户最新确认，将任务正式升级为“无兼容的全量命名体系重构”
- [x] 2026-04-08：锁定最终新命名体系：`control_center`、`plan_center`、`review_center`、`dispatch_center`、`code_specialist`、`deploy_specialist`、`data_specialist`、`docs_specialist`、`audit_specialist`、`admin_specialist`、`search_specialist`
- [x] 2026-04-08：确认取消原 `zaochao` 的“早朝/情报简报”定位，将其改造为“搜索专家（`search_specialist`）”，并把原页面重构为 `web_search` 全网搜索页
- [x] 2026-04-08：根据用户最新更正，保留 `install.sh` 与 `install.ps1`，但后续所有文档统一改为优先推荐 AI 部署
- [x] 2026-04-08：完成阶段检查点 `review_notes/restructure_checkpoint_20260408.md` 与全仓命名耦合审计摘要 `review_notes/full_rename_audit_summary_20260408.md`
- [x] 2026-04-08：复核发现“已清零当前 todo 剩余待办”判断过早，仓库内仍有公开说明、描述文件与脚本注释残留旧术语
- [x] 2026-04-08：已清理 `edict.service` 中的 `Description=` 与服务模板注释旧表述
- [x] 2026-04-08：已清理 `.github/CODEOWNERS` 文件头部的旧术语注释
- [x] 2026-04-08：已清理 `Dockerfile` 顶部的旧术语标题与旧镜像示例命名
- [x] 2026-04-08：已根据用户要求确认 Docker 不属于提供与维护范围，并已将该约束补回 todo
- [x] 2026-04-08：已在 `README.md`、`README_EN.md`、`README_JA.md` 中明确 Docker 不属于当前提供与维护范围
- [x] 2026-04-08：二次全仓库扫描发现旧术语残留范围超出 description 文件，已扩展到 `agents/`、`tests/`、脚本与示例数据
- [x] 2026-04-08：已清理 `edict.sh` 头部与状态输出中的“三省六部”旧表述，开始推进脚本主线残留清理
- [x] 2026-04-08：已清理 `start.sh` 头部与启动横幅中的“三省六部”旧表述
- [x] 2026-04-08：已清理 `uninstall.sh` 对外可见标题、提示语与完成横幅中的“三省六部”旧表述，并保留历史 agent 标识符以避免破坏卸载逻辑
- [x] 2026-04-08：已清理 `install.sh` 顶部命名、工作协议文案与初始化示例数据中的旧表述，并保留历史 agent 注册与 workspace 逻辑不变
- [x] 2026-04-08：已清理 `install.ps1` 顶部命名、工作协议文案、注册提示语与完成横幅中的旧表述，并保留历史 agent 注册逻辑不变
- [x] 2026-04-08：已清理 `scripts/run_loop.sh` 顶部命名、日志文件名与启动横幅中的旧表述，并保留刷新循环与调度扫描逻辑不变
- [x] 2026-04-08：已清理 `requirements.txt` 中 AgentRec 依赖注释的旧角色体系表述
- [x] 2026-04-08：已按最新决策删除仓库中的 Docker 相关文件、Compose 配置与 `docker/demo_data/` 演示数据目录，后续仅需清理残余文档引用与旧术语
- [x] 2026-04-08：继续推进前端核心语义迁移，已在 `edict/frontend/src/store.ts` 中把页签触发与全局状态字段从 `morning` 切换到 `web_search` / `searchBrief` 口径，下一步继续清理 `api.ts` 与页面组件命名

## 八、完成定义

- [x] 当前已形成统一的全局 TODO 基线
- [x] 当前 TODO 已支持逐项打勾
- [x] 飞书群聊回复机制主线已完成
- [x] 看板认证与访问控制主线已完成
- [ ] 所有遗留待办均被逐项打勾清零
