# Opencode 部署手册与 README 收口记录

## 一、处理目标

本轮调整的目标有两项。第一，新增一份**专门给 AI 执行器使用**的部署说明文档，让 opencode 之类的自动执行代理能够按固定顺序完成正式部署与自检。第二，将仓库中受维护的 README 统一更新到同一口径，使其不再把旧入口、旧脚本或模糊的部署说明混为一谈，而是统一引导到新的执行手册。

## 二、新增文档

本轮新增 `docs/opencode-ai-deployment-runbook.md`，作为当前仓库的 AI 部署执行主入口。其核心作用不是做概念介绍，而是把**预检、正式安装、正式启动、健康检查、根路径验证、失败分流**写成能直接执行的顺序化步骤。

| 文档 | 作用 |
| --- | --- |
| `docs/opencode-ai-deployment-runbook.md` | 给 AI / opencode 使用的正式部署与自检手册 |
| `docs/project-notes/change-notes/OPENCODE_RUNBOOK_AND_README_ALIGNMENT_2026-04-25.md` | 记录本轮收口范围与结果 |

## 三、README 收口范围

本轮已更新的 README 不再把开发模式、过时启动脚本名或历史留痕误当成正式部署入口，而是统一补入新的执行手册导航。

| 文件 | 收口方式 |
| --- | --- |
| `README.md` | 新增 opencode 部署手册入口，并纳入首页导航与版本日志 |
| `README_EN.md` | 将新的 runbook 设为 AI 部署首选执行文档 |
| `README_JA.md` | 将 AI 支援导入入口改为新 runbook，并修正过时脚本名 |
| `agentorchestrator/README.md` | 明确其为历史改造留痕，不作为部署入口 |
| `docs/project-notes/README.md` | 明确 AI / opencode 正式部署说明的位置 |
| `docs/screenshots/README.md` | 截图验证改为显式依赖正式入口与新手册 |
| `examples/README.md` | 在案例阅读前增加正式部署引导 |
| `docs/archive/root_legacy_notes/README_modern_cn_cleanup_20260407.md` | 增加历史归档提示，避免被误读为现行部署说明 |

## 四、同步调整

除 README 外，还同步更新了 `docs/getting-started.md`，把部署前 AI 检查的推荐入口从旧的审计模板文档切换为新的 opencode 执行手册，同时保留旧文档作为补充参考。

## 五、验证结果

本轮已完成两类验证。第一，检查新的 runbook 是否已被主 README、多语言 README、截图说明、案例说明、项目留痕索引与相关归档文档正确引用。第二，复查受维护文档中是否还残留明显过时的部署入口表述，例如旧 `start.sh`、开发端口或“正式前端开发入口”等描述。验证结果显示，新的执行手册入口已经接入主要文档，显著过时的部署表述已收口。

## 六、结论

当前仓库已经形成更适合 AI 自动执行的部署文档结构：**执行型代理先读 runbook，再按正式主链路部署并自检；其他 README 负责补充定位、上下文和各自目录用途。** 这样可以减少“README 看起来能部署，但 AI 不知道到底先做什么、如何判定成功”的问题。
