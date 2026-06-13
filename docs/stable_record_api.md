# 稳定记录点 API 参考文档

## 目录

1. [服务类 API](#1-服务类-api)
2. [命令行工具 API](#2-命令行工具-api)
3. [数据结构参考](#3-数据结构参考)
4. [事件总线集成](#4-事件总线集成)

---

## 1. 服务类 API

### 1.1 StableRecordService

主服务类，提供稳定记录点的所有功能。

```python
from app.services.stable_record_service import StableRecordService

# 初始化
service = StableRecordService(records_dir="/path/to/records")
```

---

#### 1.1.1 auto_create_if_needed

**自动判断并创建记录点**

```python
def auto_create_if_needed(
    self,
    task_id: str,
    context: Dict[str, Any],
    default_title: Optional[str] = None
) -> Tuple[bool, Optional[StableRecord]]
```

**参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | str | 是 | 任务ID |
| context | Dict | 是 | 上下文信息 |
| default_title | str | 否 | 默认标题，不指定则自动生成 |

**context 支持的字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| task_code | str | 任务代号 |
| task_title | str | 任务标题 |
| task_state | str | 任务状态 (PlanCenter/Doing/Done等) |
| task_progress | int | 任务进度百分比 (0-100) |
| ci_passed | bool | CI测试是否通过 |
| test_coverage | int | 测试覆盖率百分比 |
| bug_count | int | 当前Bug数量 |
| event_type | str | 事件类型 (hotfix/deploy等) |
| message | str | 上下文消息 |
| manual_request | bool | 是否人工请求 |
| node | str | 创建节点/角色 |
| has_activity | bool | 是否有活动（用于时间规则） |
| last_record_time | float | 上次记录时间戳（用于时间规则） |
| extra_info | Dict | 额外信息，会保存到记录中 |

**返回值**:
- `Tuple[是否创建成功, 记录点对象]`

**示例**:

```python
context = {
    "task_code": "CONTRO-20260430-004",
    "task_title": "设计Agent决策保存机制",
    "task_state": "Done",
    "task_progress": 100,
    "ci_passed": True,
    "test_coverage": 85,
    "node": "code_specialist"
}

created, record = service.auto_create_if_needed(
    task_id="09720ab3-1e2b-4005-8b76-61fa928652b6",
    context=context
)

if created:
    print(f"记录点已创建: {record.record_id}")
    print(f"置信度: {record.confidence_score}%")
```

---

#### 1.1.2 create_record

**手动创建记录点**

```python
def create_record(
    self,
    title: str,
    status: str = RecordStatus.STABLE,
    node: str = "system",
    reason: str = "手动创建",
    trigger_rule: str = "",
    confidence_score: float = 100.0,
    remark: str = "",
    task_id: str = "",
    task_code: str = "",
    extra_info: Optional[Dict[str, Any]] = None
) -> StableRecord
```

**参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| title | str | 必填 | 记录点标题 |
| status | str | "稳定运行" | 状态 |
| node | str | "system" | 创建节点/角色 |
| reason | str | "手动创建" | 创建原因 |
| trigger_rule | str | "" | 触发的规则ID，逗号分隔 |
| confidence_score | float | 100.0 | 决策置信度 (0-100) |
| remark | str | "" | 备注信息 |
| task_id | str | "" | 关联任务ID |
| task_code | str | "" | 关联任务代号 |
| extra_info | Dict | None | 额外信息 |

**返回值**:
- `StableRecord`: 创建的记录点对象

**示例**:

```python
record = service.create_record(
    title="核心模块重构完成",
    status=RecordStatus.MILESTONE,
    node="code_specialist",
    reason="里程碑达成：重构、测试、文档全部完成",
    task_id="09720ab3-1e2b-4005-8b76-61fa928652b6",
    task_code="CONTRO-20260430-004",
    extra_info={
        "modules_affected": ["auth", "user", "payment"],
        "test_results": "all_passed",
        "performance_improvement": "+25%"
    }
)

print(f"记录点ID: {record.record_id}")
print(f"Git提交: {record.git_commit}")
```

---

#### 1.1.3 should_create_record

**判断是否应该创建记录点（不实际创建）**

```python
def should_create_record(
    self,
    context: Dict[str, Any]
) -> Tuple[bool, float, List[str]]
```

**返回值**:
- `Tuple[是否应该创建, 综合置信度, 触发的规则ID列表]`

**示例**:

```python
should_create, confidence, rules = service.should_create_record(context)

print(f"是否应该创建: {should_create}")
print(f"置信度: {confidence:.1f}%")
print(f"触发规则: {', '.join(rules)}")
```

---

#### 1.1.4 evaluate_all_rules

**评估所有规则的匹配度**

```python
def evaluate_all_rules(
    self,
    context: Dict[str, Any]
) -> List[Tuple[Rule, float]]
```

**返回值**:
- 规则和匹配度的列表，按优先级排序

**示例**:

```python
results = service.evaluate_all_rules(context)

for rule, score in results:
    print(f"{rule.name}: {score:.1f}% (优先级: {rule.priority.name})")
```

---

#### 1.1.5 list_records

**列出历史记录点**

```python
def list_records(
    self,
    limit: int = 20,
    task_id: Optional[str] = None
) -> List[StableRecord]
```

**参数**:
- `limit`: 返回数量限制，默认20
- `task_id`: 按任务ID过滤

**示例**:

```python
# 列出最近10个记录
records = service.list_records(limit=10)

# 列出特定任务的记录
task_records = service.list_records(task_id="09720ab3-1e2b-4005-8b76-61fa928652b6")
```

---

#### 1.1.6 get_record

**根据ID获取单个记录点**

```python
def get_record(self, record_id: str) -> Optional[StableRecord]
```

**示例**:

```python
record = service.get_record("STABLE_20240115_143022")
if record:
    print(record.title)
```

---

#### 1.1.7 add_custom_rule

**添加自定义规则**

```python
def add_custom_rule(self, rule: Rule) -> None
```

**示例**:

```python
from app.services.stable_record_service import Rule, RuleType, RulePriority

custom_rule = Rule(
    rule_id="my_custom_rule",
    rule_type=RuleType.TASK_COMPLETION,
    name="我的自定义规则",
    description="进度达到90%时触发",
    priority=RulePriority.MEDIUM,
    threshold=70.0,
    enabled=True,
    config={"min_progress": 90}
)

service.add_custom_rule(custom_rule)
```

---

### 1.2 全局单例获取

```python
from app.services.stable_record_service import get_stable_record_service

service = get_stable_record_service()
```

---

## 2. 命令行工具 API

脚本路径: `scripts/stable_record.py`

### 2.1 命令行选项

```bash
python3 scripts/stable_record.py [OPTIONS]
```

#### 模式选择（互斥）:

| 选项 | 说明 |
|------|------|
| `--auto` | 自动判断是否创建记录点 |
| `--check` | 只检查是否需要创建，不实际创建 |
| `--list` | 列出最近的记录点 |
| `--rules` | 显示所有判断规则 |

#### 记录参数:

| 选项 | 说明 |
|------|------|
| `--title`, `-t` | 记录标题（手动模式必填） |
| `--status`, `-s` | 状态: 稳定运行/测试中/里程碑/热修复/已部署 |
| `--node`, `-n` | 创建节点/角色 |
| `--remark`, `-r` | 备注信息 |

#### 自动模式参数:

| 选项 | 说明 |
|------|------|
| `--task-id` | 任务ID |
| `--task-code` | 任务代号 |
| `--task-state` | 任务状态: PlanCenter/ReviewCenter/Doing/Done |
| `--task-progress` | 任务进度百分比 0-100 |
| `--task-title` | 任务标题 |
| `--ci-passed` | CI测试是否通过 |
| `--test-coverage` | 测试覆盖率百分比 |
| `--bug-count` | 当前Bug数量 |
| `--event-type` | 事件类型: hotfix/deploy/milestone |
| `--message` | 上下文消息 |
| `--manual` | 人工请求创建（强制触发） |
| `--context` | JSON格式的额外上下文信息 |
| `--force` | 强制创建，跳过规则判断 |

#### 列表参数:

| 选项 | 说明 |
|------|------|
| `--limit` | 列出记录的数量，默认10 |

---

### 2.2 命令行示例

```bash
# 1. 手动创建记录点
python3 scripts/stable_record.py --title "用户模块重构完成" --node "code_specialist" --status "里程碑"

# 2. 自动判断创建（任务完成）
python3 scripts/stable_record.py --auto \
  --task-id "09720ab3-1e2b-4005-8b76-61fa928652b6" \
  --task-code "CONTRO-20260430-004" \
  --task-state "Done" \
  --task-progress 100

# 3. CI集成：测试通过后自动创建
python3 scripts/stable_record.py --auto \
  --ci-passed \
  --test-coverage 85 \
  --node "CI系统"

# 4. 只检查不创建（用于脚本判断）
python3 scripts/stable_record.py --check \
  --task-id "xxx" \
  --context '{"task_progress": 90}'

# 通过退出码判断结果: 0=需要创建, 1=不需要
if [ $? -eq 0 ]; then
    echo "需要创建记录点"
fi

# 5. 列出最近的记录
python3 scripts/stable_record.py --list --limit 20

# 6. 查看所有判断规则
python3 scripts/stable_record.py --rules

# 7. 强制创建（跳过规则判断）
python3 scripts/stable_record.py --auto --force --node "system"

# 8. 热修复完成后创建
python3 scripts/stable_record.py --auto \
  --event-type "hotfix" \
  --message "修复了生产环境的支付超时问题" \
  --node "oncall_engineer"
```

---

## 3. 数据结构参考

### 3.1 StableRecord

记录点数据对象，包含以下属性:

| 属性 | 类型 | 说明 |
|------|------|------|
| record_id | str | 唯一记录ID，格式: STABLE_YYYYMMDD_HHMMSS |
| title | str | 记录点标题 |
| status | str | 状态 |
| node | str | 创建节点/角色 |
| saved_at | str | 保存时间，ISO格式 |
| saved_by | str | 创建者 |
| reason | str | 创建原因 |
| trigger_rule | str | 触发的规则ID，逗号分隔 |
| confidence_score | float | 决策置信度 |
| remark | str | 备注 |
| task_id | str | 关联任务ID |
| task_code | str | 关联任务代号 |
| git_commit | str | Git提交哈希（短格式） |
| git_branch | str | Git分支名 |
| extra_info | Dict | 额外信息 |

**方法**:

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `to_dict()` | Dict | 转换为字典 |
| `to_json(indent=2)` | str | 转换为格式化JSON字符串 |

---

### 3.2 RecordStatus (Enum)

状态枚举:

| 值 | 说明 |
|----|------|
| `STABLE` | "稳定运行" |
| `TESTING` | "测试中" |
| `MILESTONE` | "里程碑" |
| `HOTFIX` | "热修复" |
| `DEPLOYED` | "已部署" |

---

### 3.3 RuleType (Enum)

规则类型枚举:

| 值 | 说明 |
|----|------|
| `TASK_COMPLETION` | 任务完成度 |
| `TIME_INTERVAL` | 时间间隔 |
| `QUALITY_THRESHOLD` | 质量阈值 |
| `RISK_EVENT` | 风险事件 |
| `MANUAL_REQUEST` | 人工请求 |

---

### 3.4 RulePriority (Enum)

规则优先级枚举:

| 值 | 权重 | 说明 |
|----|------|------|
| `LOW` | 1 | 低优先级 |
| `MEDIUM` | 2 | 中优先级 |
| `HIGH` | 3 | 高优先级 |

---

## 4. 事件总线集成

### 4.1 事件主题

```python
from app.services.event_bus import (
    TOPIC_STABLE_RECORD_CREATED,
    TOPIC_STABLE_RECORD_AUTO
)
```

| 主题 | 说明 |
|------|------|
| `TOPIC_STABLE_RECORD_CREATED` | 记录点创建完成事件 |
| `TOPIC_STABLE_RECORD_AUTO` | 自动决策事件 |

### 4.2 事件载荷

#### stable_record.created

```json
{
  "record_id": "STABLE_20240115_143022",
  "title": "任务完成: xxx",
  "status": "已完成",
  "confidence_score": 92.5,
  "task_id": "...",
  "task_code": "...",
  "trigger_rule": "task_done",
  "created_at": "2024-01-15T14:30:22"
}
```

---

## 5. 与任务系统集成

### 5.1 任务状态流转钩子

在 `TaskService.transition_state()` 中已内置集成，当任务状态变为 `Done` 时自动创建记录点。

**集成代码位置**:
`agentorchestrator/backend/app/services/task_service.py` → `_try_create_stable_record()`

### 5.2 任务元数据更新

创建记录点成功后，会自动更新任务的 `meta` 字段:

```json
{
  "stable_records": [
    {
      "record_id": "STABLE_20240115_143022",
      "created_at": "2024-01-15 14:30:22",
      "reason": "任务完成"
    }
  ]
}
```

---

## 6. 错误处理

### 6.1 常见错误码

| 场景 | 处理方式 |
|------|----------|
| 规则评估异常 | 记录警告，跳过该规则 |
| 记录点创建失败 | 返回 `(False, None)` |
| 飞书通知失败 | 记录警告，不影响主流程 |
| 工作区保存失败 | 记录警告，记录点仍会保存在全局目录 |
| Git信息获取失败 | 留空，不影响创建 |

### 6.2 最佳实践

1. **总是检查返回值**: 自动创建可能因为阈值不够而不创建
2. **防抖机制**: 同一任务30分钟内重复调用不会重复创建
3. **异常处理**: 服务方法不会抛出异常，只会返回失败状态
4. **日志监控**: 关注 `agentorchestrator.stable_record_service` 日志

---

## 附录: 完整导入路径

```python
# 服务类
from agentorchestrator.backend.app.services.stable_record_service import (
    StableRecordService,
    get_stable_record_service,
    RecordStatus,
    RuleType,
    RulePriority,
    Rule,
    StableRecord
)

# 数据模型
from agentorchestrator.backend.app.models.stable_record import (
    StableRecordData,
    RuleDefinition,
    DEFAULT_RULES
)

# 事件主题
from agentorchestrator.backend.app.services.event_bus import (
    TOPIC_STABLE_RECORD_CREATED,
    TOPIC_STABLE_RECORD_AUTO
)
```
