# 2026-04-08 全仓命名耦合审计摘要

## 一、审计目的

本摘要基于 `review_notes/full_rename_audit_20260408.txt` 的当前可见结果整理，目标是为后续**无兼容的全量命名体系重构**确定优先级，避免在目录、脚本、文档、前端与示例之间反复返工。

---

## 二、当前已锁定的重构原则

| 项目 | 已确认结论 |
| --- | --- |
| Docker | 删除，不保留支持入口 |
| 旧三省六部体系 | 全量移除 |
| agent ID | 全部重构 |
| 历史兼容 | 不保留 |
| 总控中心新 ID | `centercontrol` |

---

## 三、当前审计中已经明确暴露的高耦合区域

### 1. `agents.json` 是第一优先级核心文件

从审计结果看，`agents.json` 直接定义了所有 agent 的：

| 字段 | 受影响内容 |
| --- | --- |
| `id` | 全部旧 agent ID |
| `name` | 全部旧 agent 名称 |
| `workspace` | 全部旧工作目录路径 |
| `agentDir` | 全部旧 agent 目录路径 |
| `allowAgents` | 整个调用链的旧 ID 关系 |

这说明后续结构级重构如果不先动 `agents.json`，其余目录与脚本改名将无法保持一致。

### 2. `dashboard/` 是第二优先级高风险区域

当前可见命中显示，`dashboard/` 中不仅有旧 ID，而且已经形成了大量**新中文名 + 旧 ID** 的混合映射，例如：

| 文件 | 风险 |
| --- | --- |
| `dashboard/court_discuss.py` | 旧 ID、旧官职结构、旧发言模板并存 |
| `dashboard/dashboard.html` | 过滤器、标签、角色卡片、已知 agent 列表、唤醒目标、会话解析规则都绑定旧 ID |
| `dashboard/dist/assets/...js` | 编译产物中仍嵌入旧 ID 字符串 |

这意味着 dashboard 不能只改源文件，还必须考虑**是否需要重建前端产物**，否则编译产物会残留旧值。

### 3. `docs/` 中存在大量“新称谓 + 旧内部 ID”的架构说明

当前审计可见的两个重点文件是：

| 文件 | 当前问题 |
| --- | --- |
| `docs/remote-skills-quickstart.md` | 示例命令、路径、JSON 输出、UI 说明大量依赖 `zhongshu` 等旧 ID |
| `docs/task-dispatch-architecture.md` | 已经把中文名部分改成总控中心/规划中心/评审中心/调度中心，但仍反复强调内部 ID 为旧值 |

这两类文件的风险在于：

> 如果只改目录和代码，不同步重写架构文档，项目文档会继续把新系统解释成“新称谓包装下的旧内部结构”，与用户要求的**无兼容全量重构**相冲突。

### 4. `examples/` 仍保留完整旧叙事

从此前扫描与当前审计可确定：

| 文件 | 当前状态 |
| --- | --- |
| `examples/README.md` | 仍用“三省六部”“中书→门下→尚书”等旧流程说明 |
| `examples/code-review.md` | 仍用兵部、刑部、门下省、尚书省等整套旧叙事 |
| `examples/competitive-analysis.md` | 仍保留旧分工、旧批语、旧总结构 |
| `examples/weekly-report.md` | 高概率仍残留旧术语，需复查 |

这部分应该在结构重命名后统一重写，否则 examples 会持续把仓库解释成旧架构。

### 5. `agents/` 当前处于“文案半新、结构全旧”的中间态

已看到的典型情况包括：

| 文件 | 问题 |
| --- | --- |
| `agents/shangshu/SOUL.md` | 文案已改成“部署专家/代码专家/数据专家”等，但表格里的 agent_id 仍是 `gongbu`、`bingbu`、`hubu` 等旧值 |
| `agents/bingbu/SOUL.md` 等 | 文案局部已改，但仍提到 `libu_hr` 等旧 ID |
| `agents/groups/liubu.md` | 已改成“专业执行组”表述，但仍保留旧 ID 说明 |

这说明 `agents/` 必须做真正的目录级与引用级重命名，不能再停留在文案替换层面。

---

## 四、当前已明确命中的具体文件类型

### 1. 安装与配置入口

| 文件 | 风险说明 |
| --- | --- |
| `README.md` | 安装命令仍出现 `openclaw agents add taizi` |
| `README_EN.md` | 英文安装说明仍要求 `taizi` |
| `WINDOWS_INSTALL_CN.md` | 批量列出所有旧 workspace 路径与旧 agent ID |
| `agents.json` | 全系统 agent 基础定义仍是旧体系 |

### 2. 代码与迁移层

| 文件 | 风险说明 |
| --- | --- |
| `dashboard/court_discuss.py` | 旧 ID 与旧角色模板 deeply embedded |
| `dashboard/dashboard.html` | 旧 ID 在前端逻辑中大量硬编码 |
| `edict/migration/versions/001_initial.py` | 仍有默认组织值如“太子” |
| `edict/scripts/kanban_update_edict.py` | 仍有旧状态流转、旧中文组织名与旧 ID 映射 |

### 3. 文档与示例层

| 文件 | 风险说明 |
| --- | --- |
| `docs/remote-skills-quickstart.md` | 命令、路径、返回示例均依赖旧 ID |
| `docs/task-dispatch-architecture.md` | 架构图文字已半新半旧，需整体重写 |
| `examples/*` | 仍完整保留旧叙事体系 |

---

## 五、当前最关键的技术事实

### 1. 这不是简单查找替换

因为从现有命中可见，旧命名出现在以下不同层级：

| 层级 | 表现 |
| --- | --- |
| 目录层 | `agents/taizi`、`agents/zhongshu` 等 |
| 配置层 | `agents.json`、allowAgents 链路 |
| 逻辑层 | dashboard 前端脚本、后端映射、看板派发逻辑 |
| 数据层 | migration 默认值、测试样例、示例 JSON |
| 文档层 | 安装文档、架构文档、示例案例、快速入门 |
| 产物层 | `dashboard/dist/assets/*.js` 编译文件 |

因此后续必须分层处理，不能只跑一次文本替换。

### 2. 编译产物会放大遗漏风险

`dashboard/dist/assets/index-*.js` 已经命中旧值，说明：

> 即使源代码已改，若不重新构建或替换编译产物，最终仓库仍会残留旧 ID。

### 3. 当前文案改写已经造成“新中文名 + 旧 ID”混合态

这类混合态在 `dashboard`、`agents`、`docs/task-dispatch-architecture.md` 中尤为明显。它会造成两个直接问题：

1. 用户阅读时误以为系统已经完成新架构切换；
2. 实际代码和配置仍然依赖旧 ID，导致后续重构难以辨认哪些值是最终值、哪些只是过渡值。

---

## 六、建议的实际重构顺序

| 顺序 | 目标 | 说明 |
| --- | --- | --- |
| 1 | 先锁定全部最终新 ID 映射表 | 目前只明确锁定了 `centercontrol`，其余仍需统一最终写死 |
| 2 | 修改 `agents.json` | 作为全系统 agent 主配置，是目录与调用链的总入口 |
| 3 | 重命名 `agents/` 目录及其内部引用 | 先结构后文案，避免继续出现半新半旧 |
| 4 | 修改 `scripts/`、`edict/scripts/`、`migration/` | 处理状态流转、组织名和默认值 |
| 5 | 修改 `dashboard/` 源文件 | 包括过滤器、角色表、已知 agent 列表、唤醒目标等 |
| 6 | 处理 `dashboard/dist/` 产物 | 视项目构建方式决定重建或替换 |
| 7 | 重写 `docs/`、`examples/`、`README` | 用最终结构反推文档，减少反复返工 |
| 8 | 最后跑全仓 grep 回归 | 确认旧 ID、旧中文术语、残余 Docker 引用已清空 |

---

## 七、下一步执行建议

下一步应优先做两件事：

1. **正式锁定完整新 ID 对照表**，不能只锁定 `centercontrol`；
2. **从 `agents.json` 和 `agents/` 目录开始做结构级重命名**，而不是继续零散修改文档。

> 只有先完成结构级替换，后续文档与示例的改写才有稳定参照系。
