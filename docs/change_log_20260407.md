# 2026-04-07 改造记录

## 概要

本轮围绕 **多Agent智作中枢** 的系统化现代化改造继续推进，已不再停留于单点修补，而是覆盖了真实运行看板、服务端可见文案、React 前端关键组件、安装与快速开始文档，以及新增的 **上下文窗口管理** 机制。

本次记录用于保留项目痕迹，避免后续重复盘点，并作为最终交付前的中间变更日志。

## 已完成项

| 类别 | 本轮已完成内容 | 主要文件 |
|---|---|---|
| 运行看板 | 新增“直连调度中心”窗口，并确保真实首页入口指向已改造的 `dashboard.html` | `dashboard/dashboard.html` `dashboard/server.py` |
| 中文体系统一 | 将运行调度、任务详情、在线状态、阶段标签、Agent 标签等大面积旧体系名称统一为现代中文体系 | `dashboard/dashboard.html` `dashboard/server.py` `edict/frontend/src/**/*` |
| 刷新机制 | 真实运行看板主刷新链路改为 **增量优先**，并保留任务详情局部回显与联动刷新 | `dashboard/dashboard.html` |
| Registry / SOUL / 部署 | 安装与同步链路说明已统一为 **Registry 自动生成、SOUL 自动部署、openclaw.json 只读对接** | `install.sh` `docs/getting-started.md` `README.md` `ROADMAP.md` |
| 上下文窗口管理 | 新增容量评估、预警分级、压缩归档、续写提示、看板徽标与任务详情面板 | `edict/backend/app/config.py` `edict/backend/app/workers/dispatch_worker.py` `edict/backend/app/models/task.py` `dashboard/dashboard.html` |
| 核心文档 | README、快速开始、路线图、Windows 安装文档已补入现代中文体系与上下文治理说明 | `README.md` `docs/getting-started.md` `ROADMAP.md` `WINDOWS_INSTALL_CN.md` |

## 上下文窗口管理已落地的处理方案

| 场景 | 当前处理方式 | 对用户可见位置 |
|---|---|---|
| 接近上限 | 派发前评估容量，标记 `warning` 或 `critical` | 任务卡片徽标、任务详情面板 |
| 超限风险 | 自动压缩历史流转与进展，保留最近窗口并写入归档路径 | 任务详情“上下文窗口管理” |
| 长链路续做 | 注入续写提示，建议下一轮基于归档摘要继续 | 任务详情面板、任务元数据 |
| 运行中观察 | 看板显示“上下文接近上限 / 已压缩 / 可续写” | 真实运行看板 |

## 已验证项

1. `dashboard/dashboard.html` 内嵌脚本已完成语法校验。
2. 后端上下文窗口管理相关 Python 文件已完成编译校验。
3. 实际浏览器检查已确认运行调度页中的在线状态区与下半区执行状态卡片已切换到现代中文体系。
4. React 前端此前已重新构建通过，关键命名修正未阻塞构建。

## 仍建议继续核对的项

| 优先级 | 项目 | 说明 |
|---|---|---|
| 高 | `SECURITY.md` 等剩余高可见文档 | 仍需确认是否还残留旧体系命名或过时安装表述 |
| 高 | 最终联调 | 需要再做一轮端到端核查，确认上下文预警在真实任务中能触发与展示 |
| 中 | React 前端剩余低频页面 | 虽已做多轮清理，但仍应再做全量扫描确认无漏网旧术语 |
| 中 | 交付总结 | 最终需要整理“已改 / 未改 / 建议后续”并附关键文件 |

## 本轮新增关键文件与痕迹

- `docs/browser_findings_20260407_refresh_and_dispatch.md`
- `docs/gap_audit_20260407.md`
- `docs/change_log_20260407.md`

## 备注

后续若继续推进，建议优先进入“最终联调与剩余文档收口”阶段，以避免项目表面已完成但仍存在局部残留或说明不一致的问题。
