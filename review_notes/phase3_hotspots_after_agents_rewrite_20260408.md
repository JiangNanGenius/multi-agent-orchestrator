# 第 3 阶段重构热点清单（agents 核心改写后）

## 当前结论

在完成 `agents.json`、`agents/` 目录首批结构级改名与部分 SOUL 文档重写后，全仓仍存在大量旧命名体系残留。当前仓库仍处于**中间态**：核心 agent 目录已开始切换到新体系，但安装脚本、看板、前后端状态映射、示例文档和测试输入还没有完成同步，因此仍会出现旧 ID、旧组织名和“早朝/情报简报”叙事。

## 已锁定的新命名体系

| 旧 ID | 新 ID | 中文名称 |
| --- | --- | --- |
| `taizi` | `control_center` | 总控中心 |
| `zhongshu` | `plan_center` | 规划中心 |
| `menxia` | `review_center` | 评审中心 |
| `shangshu` | `dispatch_center` | 调度中心 |
| `bingbu` | `code_specialist` | 代码专家 |
| `gongbu` | `deploy_specialist` | 部署专家 |
| `hubu` | `data_specialist` | 数据专家 |
| `libu` | `docs_specialist` | 文案专家 |
| `xingbu` | `audit_specialist` | 审计专家 |
| `libu_hr` | `admin_specialist` | 管理专家 |
| `zaochao` | `search_specialist` | 搜索专家 |

## 已确认的功能重定义

> 原 `zaochao` 不再保留“早朝/情报简报”定位，而是改造为 `search_specialist`，对应中文名称“搜索专家”；原早朝页面改造为 `web_search` 全网搜索页。

## 当前最高优先级热点

| 优先级 | 路径 | 问题类型 | 说明 |
| --- | --- | --- | --- |
| P0 | `install.sh` | 安装与初始化脚本 | 仍保留旧 AGENTS 列表、旧 workspace 路径、旧 `allowAgents`、旧提示命令 |
| P0 | `install.ps1` | Windows 安装脚本 | 与 `install.sh` 相同，仍保留全套旧 ID 和旧工作目录 |
| P0 | `dashboard/dashboard.html` | 旧看板主页面 | 仍含旧 CSS 类、旧过滤器、旧 agent 注册表、旧映射、旧“早朝简报”页签与相关文案 |
| P0 | `dashboard/server.py` | 看板后端 | 仍含旧 agent 列表、旧状态映射、旧触发器命名与旧升级目标 |
| P0 | `edict/backend/app/models/task.py` | 后端状态到 agent 映射 | 仍大量映射到旧 ID，且保留旧组织名与中文别名 |
| P0 | `edict/backend/app/workers/orchestrator_worker.py` | 主编排器 | 仍以旧状态流转和旧 agent 作为默认目标与升级链 |
| P0 | `edict/backend/app/workers/dispatch_worker.py` | 派发与分组逻辑 | 仍保留 `sansheng` / `liubu` 分组、旧 agent 池和旧提醒文案 |
| P0 | `edict/backend/app/api/agents.py` | agent 展示配置 | 仍暴露旧 `zaochao` 与旧 ID 到前端 API |
| P0 | `edict/frontend/src/store.ts` | 前端核心映射 | 仍保留旧颜色、旧中文别名替换、旧 agent 列表、晨报中心旧叙事 |
| P0 | `edict/frontend/src/components/TaskModal.tsx` | 任务详情映射 | 仍将旧 ID 直接映射到中文名称 |
| P0 | `edict/frontend/src/components/CourtDiscussion.tsx` | 协同讨论组件 | 仍使用旧 ID、旧位置布局和旧分组结构 |
| P0 | `edict/frontend/src/components/CourtCeremony.tsx` | 仪式文案 | 仍显示“早朝开始” |
| P0 | `dashboard/dist/assets/*` | 编译产物 | 仍含旧看板代码；待源码改完后必须重新构建 |
| P1 | `README_EN.md` | 安装示例 | 仍提示 `openclaw agents add taizi` |
| P1 | `WINDOWS_INSTALL_CN.md` | 安装文档 | 仍保留旧 workspace 目录与旧 agent 列表 |
| P1 | `docs/remote-skills-guide.md` | 远程技能文档 | 仍使用 `zhongshu`、`bingbu` 等旧 agent 示例与旧路径 |
| P1 | `docs/remote-skills-quickstart.md` | 快速入门 | 与上类似，旧 agent 名称密集残留 |
| P1 | `README_modern_cn_cleanup_20260407.md` | 旧清理复盘文档 | 仍记录历史兼容说明，需重写或明确归档语义 |
| P2 | `edict/frontend/src/index.css` | 旧样式类 | 仍保留 `dt-中书省` 等旧类名，需与前端 store / 页面展示一并替换 |

## 推荐的后续执行顺序

| 顺序 | 任务 |
| --- | --- |
| 1 | 先重构 `install.sh` 与 `install.ps1`，统一工作目录、默认 agent 列表与初始化提示 |
| 2 | 再重构后端核心映射：`task.py`、`orchestrator_worker.py`、`dispatch_worker.py`、`api/agents.py` |
| 3 | 随后重构前端核心映射：`store.ts`、`TaskModal.tsx`、`CourtDiscussion.tsx`、`CourtCeremony.tsx` |
| 4 | 再重构旧看板源码 `dashboard/dashboard.html` 与 `dashboard/server.py` |
| 5 | 然后批量清理文档：`README_EN.md`、`WINDOWS_INSTALL_CN.md`、`docs/remote-skills-*` |
| 6 | 最后重新构建前端 / 看板产物并进行二次全仓扫描 |

## 执行提醒

1. 本次为**无兼容硬切换**，不得继续保留旧 ID → 新 ID 的兼容映射作为运行主路径。
2. `zaochao` 相关 UI、API、文案、过滤器和状态入口要统一改成**搜索专家 / 全网搜索页**语义。
3. `dashboard/dist/assets/*` 不应直接手工修补，应该在源码改完后通过重新构建生成。
4. 每完成一个高优先级区域，都需要同步更新 `todo.md` 和 `review_notes/` 留痕。
