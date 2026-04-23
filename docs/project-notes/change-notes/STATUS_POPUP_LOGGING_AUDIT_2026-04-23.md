# 状态弹窗与错误日志机制核查记录（2026-04-23）

## 核查结论

当前项目**已经具备一套基础状态提示能力**，但还**不能算“各种状态的弹窗提示都完整做完”**；同时，项目**已经有日志落盘**，但**并没有实现带容量上限的滚动错误日志**。

## 一、状态弹窗 / 提示是否都做了

前端已经实现了全局 toast 提示，并在大量操作路径中调用，例如任务创建、任务操作、搜索、系统设置、会场推进、技能管理和消息发送等，因此“操作成功/失败”的基础反馈是有的。[1] [2]

但是，这套提示系统目前仍然比较轻量。

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| 全局 toast | 已有 | 由 Zustand store 统一维护，并由 `Toaster` 渲染 [1] [2] |
| toast 类型 | 仅部分覆盖 | 只有 `ok` 和 `err` 两种类型，没有独立的 `warn` / `info` / `loading` / `progress` 类型 [1] [2] |
| toast 生命周期 | 已有但固定 | 3 秒后自动消失，当前没有持久提示或手动关闭逻辑 [1] |
| 确认类弹窗 | 已有 | 存在 `ConfirmDialog`，也有部分地方直接使用确认交互 [3] |
| 任务级通知 | 已有 | 任务详情里有“工作区通知”“风险确认链路”等区域 [4] [5] |
| 严重级别字段 | 后端有，前端部分展示 | 通知对象带 `kind`、`severity`、`requires_ack`、`acknowledged` 字段，但前端没有形成统一的多级弹窗体系 [5] [4] |
| 日志窗口 / 错误中心 | 未见完整实现 | 当前更像“任务通知 + 自动化记录面板”，不是完整独立的错误日志窗口 [6] |

因此，如果你的标准是“成功、失败、警告、信息、加载中、处理中、需确认、可追溯历史”都要形成统一提示体系，那么**现在还没完全做齐**。当前更准确的说法应是：**基础 toast + 确认弹窗 + 任务级通知 已有，但统一的全状态提示体系尚未完整闭环。**

## 二、错误日志是否有保存，且是否滚动保存、有上限

这里要分成两类看。

### 1. 进程级日志

统一启动脚本会把 API、orchestrator、dispatch、outbox 四个进程的输出分别追加写入 `logs/` 目录下的日志文件，例如 `api.log`、`orchestrator.log`、`dispatch.log`、`outbox.log`。[7]

后端主入口和 worker 使用的是 `logging.basicConfig(...)` 形式的标准日志输出，没有看到 `RotatingFileHandler`、`TimedRotatingFileHandler`、`maxBytes`、`backupCount` 之类的轮转与保留上限配置。[8]

工作区里虽然也有 JSONL ledger 追加写入机制，但 `_append_jsonl()` 只是简单 append，没有做裁剪、轮转或大小限制。[9]

所以，**错误日志是有保存的，但当前不是“滚动保存、有上限”的实现**。更准确地说，是：

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| 进程日志落盘 | 已有 | 统一启动脚本将输出追加到 `logs/*.log` [7] |
| 进程日志滚动轮转 | 没有发现 | 未见 `RotatingFileHandler` / `maxBytes` / `backupCount` [8] |
| 进程日志大小上限 | 没有发现 | 当前属于持续追加 |
| 工作区 ledger 落盘 | 已有 | 事件被追加写入 `*.jsonl` [9] |
| ledger 文件裁剪上限 | 没有发现 | `_append_jsonl()` 仅追加，不裁剪 [9] |

### 2. 面板内通知 / 最近记录

面板层面的“最近通知”和“自动化记录”是有上限的，但这与真正的错误日志轮转不是一回事。

后端会把任务工作区通知规范化后仅保留最近 **20** 条；风险操作仅保留最近 **10** 条。[5] 前端自动化面板中，系统记录、通知和快捷任务等展示列表也都做了切片限制，例如最近系统处理记录取前 **18** 条，通知取前 **8** 条，快捷任务记录取前 **10** 条。[6]

因此可以说：**界面展示层有上限，任务通知数据也有上限；但进程级错误日志本身没有做滚动轮转和容量封顶。**

## 最终判断

| 问题 | 结论 |
| --- | --- |
| 各种状态的弹窗提示都做了吗 | **没有完全做齐**；基础成功/失败 toast、确认弹窗、任务级通知已存在，但缺少统一的 warning/info/loading/progress/persistent 历史体系 |
| 错误日志有保存吗 | **有**，进程输出会落盘，任务事件也会写入工作区 ledger |
| 错误日志是滚动保存并有上限吗 | **不是**；未见日志轮转和容量上限配置 |
| 面板里的记录有上限吗 | **有**；通知、风险操作和最近记录都做了数量裁剪 |

## 建议的下一步

如果你要把这块补到“完整可交付”的标准，建议下一轮直接补三件事：第一，统一前端提示中心，补齐 `ok / err / warn / info / loading` 五类并支持持久提示；第二，增加独立“日志窗口”或“错误中心”，支持查看最近错误；第三，把进程日志改成**按大小轮转 + 备份上限**，例如每个日志文件限制大小并保留有限历史。

## References

[1]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/store.ts "store.ts"
[2]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/components/Toaster.tsx "Toaster.tsx"
[3]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/components/ConfirmDialog.tsx "ConfirmDialog.tsx"
[4]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/components/TaskModal.tsx "TaskModal.tsx"
[5]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/services/task_workspace.py "task_workspace.py"
[6]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/frontend/src/components/AutomationPanel.tsx "AutomationPanel.tsx"
[7]: file:///home/ubuntu/terminal_full_output/2026-04-23_12-53-38_402050_74038.txt "日志路径与启动脚本检查输出"
[8]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/main.py "main.py"
[9]: file:///home/ubuntu/multi-agent-orchestrator_public/agentorchestrator/backend/app/services/task_workspace.py "task_workspace.py"
