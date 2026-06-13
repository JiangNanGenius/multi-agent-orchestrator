# 稳定记录点自动化机制设计文档

## 1. 概述

### 1.1 设计目标
设计并实现Agent自主决策保存稳定记录点的机制，使系统能够根据预设规则自动判断何时创建记录点，减少人工干预，提高工作流程的可追溯性。

### 1.2 核心价值
- **自动化决策**: Agent根据预设规则自主判断，无需人工触发
- **多维度触发**: 支持任务状态、时间、质量、风险事件等多种触发条件
- **系统集成**: 与任务系统、看板、工作区深度集成
- **可追溯性**: 完整记录决策过程和上下文信息

### 1.3 适用场景
- 任务完成或达到重要里程碑时
- 定时创建工作快照
- CI测试通过、代码部署成功时
- 重要问题修复完成后
- 人工明确请求保存时

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                   触发源 (Trigger Sources)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ 任务状态变更│  │ 进度更新    │  │ 代码提交    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ CI执行结果  │  │ 部署状态    │  │ 用户行为    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   决策引擎 (Decision Engine)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ 规则引擎    │→│ 条件评估器  │→│ 防抖机制    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  5种规则类型                                          │   │
│  │  • 任务完成度: 任务状态、进度、里程碑关键词           │   │
│  │  • 时间间隔: 定时保存、强制保存                       │   │
│  │  • 质量阈值: CI通过、测试覆盖率、Bug数量              │   │
│  │  • 风险事件: 热修复、部署成功、关键问题修复           │   │
│  │  • 人工干预: 用户显式请求                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   记录点服务 (Record Service)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ 创建记录点  │  │ 元数据采集  │  │ 历史查询    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   系统集成 (System Integration)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ 任务系统    │  │ 飞书看板    │  │ 工作区      │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│  ┌─────────────┐                                            │
│  │ 事件总线    │                                            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块设计

### 3.1 规则引擎 (Rule Engine)

#### 3.1.1 规则类型

| 类型 | 说明 | 触发条件示例 |
|------|------|-------------|
| **任务完成度** | 基于任务状态和进度判断 | 任务变为Done、进度≥80%、包含里程碑关键词 |
| **时间间隔** | 基于时间间隔自动保存 | 每4小时自动保存、超时强制保存 |
| **质量阈值** | 基于质量指标判断 | CI测试通过、测试覆盖率≥80%、Bug数为0 |
| **风险事件** | 基于重要事件触发 | 热修复完成、部署成功、关键问题解决 |
| **人工请求** | 用户显式触发 | 用户手动请求创建 |

#### 3.1.2 规则配置格式

```json
{
  "rule_id": "task_done",
  "rule_type": "task_completion",
  "name": "任务完成",
  "description": "当任务状态变为 Done 时自动创建记录点",
  "priority": "high",
  "threshold": 80.0,
  "enabled": true,
  "config": {
    "target_state": "Done"
  }
}
```

#### 3.1.3 内置规则

| 规则ID | 类型 | 优先级 | 阈值 | 说明 |
|--------|------|--------|------|------|
| task_done | 任务完成度 | 高 | 80% | 任务变为Done时触发 |
| milestone_reached | 任务完成度 | 中 | 75% | 包含里程碑关键词时触发 |
| time_interval_4h | 时间间隔 | 低 | 50% | 每4小时自动保存 |
| ci_success | 质量阈值 | 中 | 70% | CI通过且覆盖率达标时 |
| hotfix_applied | 风险事件 | 高 | 90% | 热修复完成时 |
| deploy_success | 风险事件 | 高 | 85% | 部署成功时 |

### 3.2 触发条件评估器

#### 3.2.1 评估流程

```
输入上下文
    ↓
遍历所有启用的规则
    ↓
逐个规则匹配计算匹配度 (0-100)
    ↓
按优先级加权计算综合置信度
    ↓
置信度 ≥ 60%?
    ├─ 是 → 触发创建
    └─ 否 → 跳过
```

#### 3.2.2 加权算法

```
综合置信度 = Σ(规则匹配度 × 优先级权重) / Σ(优先级权重)

优先级权重:
  - 高 (HIGH): 3
  - 中 (MEDIUM): 2
  - 低 (LOW): 1
```

#### 3.2.3 防抖机制

为防止短时间内频繁创建记录点，系统采用防抖机制：

- 同一任务30分钟内最多创建1个记录点
- 防抖时间可配置（默认30分钟）
- 高优先级规则可绕过防抖限制

### 3.3 决策模块

决策模块负责综合评估结果，做出最终决策：

1. **自动创建**: 置信度 ≥ 60% 且不需要人工确认
2. **待确认**: 置信度 ≥ 60% 但边界情况，需要人工确认
3. **不创建**: 置信度 < 60% 或防抖冷却中

---

## 4. 数据结构设计

### 4.1 记录点数据结构

```json
{
  "record_id": "STABLE_20240115_143022",
  "title": "任务完成: 用户认证模块重构",
  "status": "已完成",
  "node": "code_specialist",
  "saved_at": "2024-01-15 14:30:22",
  "saved_by": "auto_service",
  "reason": "触发规则: task_done, milestone_reached",
  "trigger_rule": "task_done,milestone_reached",
  "confidence_score": 92.5,
  "remark": "",
  "task_id": "09720ab3-1e2b-4005-8b76-61fa928652b6",
  "task_code": "CONTRO-20260430-004",
  "git_commit": "a1b2c3d",
  "git_branch": "feature/auth-refactor",
  "extra_info": {
    "old_state": "Doing",
    "transition_reason": "重构完成，测试通过",
    "assignee_org": "code_specialist",
    "auto_created": true
  }
}
```

### 4.2 存储位置

- **全局记录目录**: `<project-root>/stable_records/`
- **任务工作区**: `task_workspaces/<任务目录>/artifacts/stable_records/`

---

## 5. 系统集成

### 5.1 与任务系统集成

**集成点**: `TaskService.transition_state()`

**触发时机**: 任务状态变更时（主要是变为Done状态）

**集成逻辑**:
1. 状态流转完成后，自动调用稳定记录点服务
2. 传入任务上下文信息（ID、代号、标题、原状态等）
3. 服务评估是否需要创建记录点
4. 创建成功后更新任务元数据

### 5.2 与飞书看板集成

**功能**: 记录点创建后自动发送卡片通知到飞书

**卡片内容**:
- 记录点标题和ID
- 状态和置信度
- 触发规则列表
- Git提交信息
- 任务关联信息

### 5.3 与工作区集成

**功能**: 记录点自动保存到对应任务工作区

**保存内容**:
1. 记录点JSON文件 → `artifacts/`
2. 工作区快照 → `context/snapshots/`
3. 更新工作区通知

### 5.4 与事件总线集成

**事件类型**:
- `stable_record.created`: 记录点创建事件
- `stable_record.auto`: 自动决策事件

**用途**: 供其他模块订阅和响应

---

## 6. 使用方式

### 6.1 命令行使用

```bash
# 手动创建记录点
python3 scripts/stable_record.py --title "用户模块重构完成" --node "code_specialist"

# 自动判断创建（任务完成）
python3 scripts/stable_record.py --auto --task-id "xxx" --task-state "Done"

# CI集成：测试通过后自动创建
python3 scripts/stable_record.py --auto --ci-passed --test-coverage 85 --node "CI系统"

# 只检查不创建（用于脚本判断）
python3 scripts/stable_record.py --check --task-id "xxx" --context '{"task_progress": 90}'

# 列出最近的记录
python3 scripts/stable_record.py --list --limit 20

# 查看所有判断规则
python3 scripts/stable_record.py --rules
```

### 6.2 Python API 使用

```python
from agentorchestrator.backend.app.services.stable_record_service import (
    StableRecordService,
    RecordStatus
)

# 初始化服务
service = StableRecordService()

# 自动判断并创建
context = {
    "task_id": "09720ab3-1e2b-4005-8b76-61fa928652b6",
    "task_code": "CONTRO-20260430-004",
    "task_state": "Done",
    "task_progress": 100,
}
created, record = service.auto_create_if_needed(task_id, context)

# 手动创建
record = service.create_record(
    title="重要修复完成",
    status=RecordStatus.HOTFIX,
    node="code_specialist",
    reason="手动创建",
    task_id="xxx"
)

# 查询历史记录
records = service.list_records(limit=10)
```

### 6.3 配置自定义规则

```python
from agentorchestrator.backend.app.services.stable_record_service import (
    Rule, RuleType, RulePriority
)

# 添加自定义规则
custom_rule = Rule(
    rule_id="custom_rule_001",
    rule_type=RuleType.TASK_COMPLETION,
    name="我的自定义规则",
    description="当满足特定条件时触发",
    priority=RulePriority.MEDIUM,
    threshold=65.0,
    config={"custom_key": "custom_value"}
)

service.add_custom_rule(custom_rule)
```

---

## 7. 扩展与定制

### 7.1 添加新的规则类型

1. 在 `RuleType` 枚举中添加新类型
2. 在 `_evaluate_rule()` 方法中添加评估逻辑
3. 配置默认规则参数

### 7.2 自定义决策逻辑

继承 `StableRecordService` 并重写：
- `should_create_record()`: 自定义决策逻辑
- `_evaluate_rule()`: 自定义规则评估

### 7.3 扩展系统集成

重写或扩展以下方法：
- `_send_to_kanban()`: 自定义看板通知
- `_save_to_task_workspace()`: 自定义工作区保存
- `_publish_event()`: 自定义事件发布

---

## 8. 最佳实践

### 8.1 规则配置建议

- **高优先级规则**: 限制在关键节点（任务完成、部署成功等）
- **中优先级规则**: 用于重要质量指标（CI通过等）
- **低优先级规则**: 用于定时备份等辅助功能
- **避免规则过多**: 建议不超过10条规则，防止频繁触发

### 8.2 使用建议

1. **任务完成必记录**: 重要任务完成时应该有记录点
2. **定期自动备份**: 长时间运行的任务建议启用4小时定时保存
3. **质量门限**: CI通过时自动创建便于回退
4. **人工确认**: 边界情况建议先检查再创建

### 8.3 维护建议

- 定期清理过期记录点（保留关键节点即可）
- 监控规则命中率，调整不适当的阈值
- 记录决策日志，便于优化规则

---

## 9. 文件清单

| 文件路径 | 说明 |
|----------|------|
| `agentorchestrator/backend/app/services/stable_record_service.py` | 核心服务模块 |
| `agentorchestrator/backend/app/models/stable_record.py` | 数据模型 |
| `scripts/stable_record.py` | 命令行工具 |
| `docs/stable_record_mechanism.md` | 设计文档（本文件） |
| `docs/stable_record_api.md` | API参考文档 |
| `stable_records/` | 全局记录存储目录 |

---

## 10. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2024-01-15 | 初始版本，实现核心功能 |
