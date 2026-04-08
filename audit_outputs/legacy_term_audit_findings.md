# 旧术语残留分类审计草稿

## 审计范围

本轮继续围绕旧“三省六部”与“官员/奏折”叙事残留展开排查，重点覆盖前端源码、静态看板、后端接口、同步脚本、启动脚本与项目文档。当前草稿仅记录已确认命中位置，供下一步集中替换与统一映射使用。

## 一、前端源码残留

| 文件 | 残留类型 | 已确认残留 | 影响范围 | 建议方向 |
| --- | --- | --- | --- | --- |
| `edict/frontend/src/App.tsx` | 标签键、组件名 | `OfficialPanel`、`MemorialPanel`、`officials`、`memorials`、`edicts` | 顶层路由、徽标计数、面板装配 | 统一迁移到 `agents`、`archives`、`tasks` 或新的直接英文键名 |
| `edict/frontend/src/store.ts` | 全局状态字段、TabKey、加载函数 | `OfficialsData`、`officialsData`、`selectedOfficial`、`loadOfficials`、`officials`、`memorials`、`isEdict` | 全局状态、轮询加载、标签定义、兼容映射 | 先定义新权威命名，再整体重命名状态字段与标签键 |
| `edict/frontend/src/api.ts` | API 函数、类型名、字段名 | `officialsStats`、`OfficialInfo`、`OfficialsData`、`top_official`、`participated_edicts`、`officials` | 前后端类型契约与接口调用 | 与后端同步改为 `agentsStats`、`AgentOverview*`、`top_agent`、`participated_tasks` |
| `edict/frontend/src/components/OfficialPanel.tsx` | 组件名、局部状态名 | `OfficialPanel`、`officialsData`、`selectedOfficial`、`loadOfficials` | Agent 总览页主体 | 组件和状态统一改为 `AgentOverviewPanel` 或同类直接英文名 |
| `edict/frontend/src/components/MemorialPanel.tsx` | 组件名、函数名、局部变量 | `MemorialPanel`、`MemorialDetailModal`、`exportMemorial`、局部变量 `mems` | 结果归档页主体 | 迁移到 `ArchivePanel`、`ArchiveDetailModal`、`exportArchive` |
| `edict/frontend/src/components/EdictBoard.tsx` 与相关组件 | 任务语义函数 | `isEdict`、`EdictBoard` | 任务板、若干过滤逻辑 | 如决定彻底去历史兼容，建议迁移到 `isTaskRecord`、`TaskBoard` |
| `edict/frontend/src/index.css` | 样式注释、类族命名 | `Officials`、`Memorials`、`mem-*`、`off-*`、`od-edict-list` | 样式层、组件选择器 | 若不保留兼容，建议按新面板名重命名类族 |
| `edict/frontend/tailwind.config.js` | 历史注释 | `三省六部主题色` | 开发配置注释 | 可直接改为“多中心协作主题色”之类现代注释 |

## 二、静态看板与构建产物残留

| 文件 | 残留类型 | 已确认残留 | 影响范围 | 建议方向 |
| --- | --- | --- | --- | --- |
| `dashboard/dashboard.html` | 标签页键、面板 ID、函数名、变量名、接口名 | `data-tab="officials"`、`data-tab="memorials"`、`panel-officials`、`panel-memorials`、`officialsData`、`loadOfficials()`、`renderOfficials()`、`renderMemorials()`、`openMemorial()`、`officials-stats`、`top_official`、`participated_edicts`、`submitFreeEdict()`、`imperial-edict` | 旧静态版看板仍大量使用历史内部命名，是高风险盲区 | 若此实现仍保留，应与 React 前端同步做一轮彻底重构；若仅作历史兜底，至少统一公开 API 与字段名 |
| `dashboard/dist/assets/*` | 编译产物内嵌旧键名 | `officials`、`memorials`、`edicts`、旧讨论页历史官制 ID 与说明文本 | 发布产物直接外露 | 任何源码改名后都需重新构建覆盖，否则残留仍会对外可见 |

## 三、后端接口与数据模型残留

| 文件 | 残留类型 | 已确认残留 | 影响范围 | 建议方向 |
| --- | --- | --- | --- | --- |
| `dashboard/server.py` | 请求字段、接口路径、内部触发名 | `official` 参数、`/api/officials-stats`、`/api/court-discuss/officials`、`officials list required`、`handle_create_task(... official=...)`、`trigger='imperial-edict'` | 公开接口契约、任务创建、协同讨论 | 建议整体迁移到 `owner` / `agentIds` / `agents-stats` / 更直接触发名 |
| `edict/backend/app/models/task.py` | 数据字段名 | `official` 列与序列化输出 | 数据模型与历史任务记录 | 若允许破坏兼容，应连同读写链路一起迁移字段名 |
| `edict/backend/app/api/admin.py` | 诊断文件名 | `officials_stats` | 健康检查与迁移检查 | 随统计文件名一并迁移 |

## 四、脚本与启动链路残留

| 文件 | 残留类型 | 已确认残留 | 影响范围 | 建议方向 |
| --- | --- | --- | --- | --- |
| `scripts/sync_officials_stats.py` | 文件名、常量名、输出键名、字段名 | `DEFAULT_OFFICIALS`、`officials`、`top_official`、`participated_edicts`、输出 `officials_stats.json` | Agent 总览统计的权威生产端 | 这是最关键的后端源头，应优先改成新的文件名、顶层键与字段名 |
| `start.sh` | 初始化数据文件 | `officials.json`、`officials_stats.json` | 首次启动与空目录初始化 | 应与统计文件迁移同步调整 |
| `edict.sh` | 初始化数据文件 | `officials.json`、`officials_stats.json` | 服务管理脚本 | 同上 |
| `install.ps1` | 初始化示例字段、同步脚本调用 | `official` 字段、`sync_officials_stats.py` | Windows 安装链路 | 需要与脚本更名和字段迁移同步 |
| `requirements.txt` | 历史表述注释 | `三省六部 · Python 依赖` | 用户可见注释 | 可直接清理 |
| `agents/control_center/SOUL.md` | 命令示例字段 | `kanban_update.py ... <official>` | 角色说明文档与人工操作示例 | 应改成新责任字段名，避免把旧接口再传播出去 |

## 五、文档与说明残留

| 文件 | 残留类型 | 已确认残留 | 影响范围 | 建议方向 |
| --- | --- | --- | --- | --- |
| `README_EN.md` | 脚本名与目录历史名说明 | `scripts/sync_officials_stats.py`、`edict/` 多处引用 | 对外安装说明 | 如果决定彻底改名，应同步更新命令与目录说明 |
| `WINDOWS_INSTALL_CN.md` | 数据文件名与 API 路径 | `officials_stats.json`、`api/officials-stats` | Windows 部署文档 | 与后端接口更名同步更新 |
| `docs/wechat-article.md` | 截图文件名与脚本名 | `08-memorials.png`、`06-official-overview.png`、`sync_officials_stats.py` | 宣传与演示材料 | 文件名和文内命名均需更新 |
| `docs/screenshots/README.md` | 截图资产名 | `06-official-overview.png`、`08-memorials.png` | 截图索引 | 随静态资源统一更名 |
| `docs/remote-skills-guide.md`、`docs/remote-skills-quickstart.md` | 命令名 | `import-official-hub` | 技能管理操作说明 | 如功能语义已现代化，建议同步改命令名 |
| `README_modern_cn_cleanup_20260407.md`、`todo.md` 等留痕文档 | 历史说明 | 对 `edict`、旧术语清理记录的历史描述 | 项目内审计痕迹 | 可保留，但需明确“历史记录”属性，避免被误判为当前命名标准 |

## 六、当前判断的高优先级替换批次

| 优先级 | 批次 | 原因 |
| --- | --- | --- |
| P0 | `scripts/sync_officials_stats.py`、`dashboard/server.py`、`edict/frontend/src/api.ts`、`edict/frontend/src/store.ts` | 这四处共同构成统计数据生产、接口暴露与前端消费主链路，是现代命名收口的主干 |
| P1 | `OfficialPanel.tsx`、`MemorialPanel.tsx`、`App.tsx`、`index.css` | 直接决定前端内部主组件命名与路由键，影响范围大但相对可控 |
| P1 | `dashboard/dashboard.html` | 虽可能是旧实现，但当前仍是高密度残留区，若继续保留则必须同步清理 |
| P2 | `start.sh`、`edict.sh`、`install.ps1`、`WINDOWS_INSTALL_CN.md` | 与部署、初始化、文档一致性相关，需要在主链路重命名后跟进 |
| P3 | 宣传文档、截图索引、历史留痕文档 | 影响对外观感与后续维护，但对运行主链路影响较小 |

## 七、统一映射建议方向

建议下一步不要零散修补，而是先建立一份新的**唯一权威映射表**，明确现代英文 ID、中文标签、英文标签、职责说明、等级与别名集合。随后以该映射为中心，统一替换前端 `store.ts`、后端统计脚本、接口类型、静态看板和文档中的派生名称。若按当前用户偏好执行“几乎完全重构且不考虑历史兼容”，则不应继续保留 `officials`、`memorials`、`edicts` 作为内部状态键，而应一次性切换到更直接的英文单词体系。
