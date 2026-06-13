"""
稳定记录点数据模型

提供数据库持久化支持（可选），当前主要使用文件系统存储。
如果需要数据库存储，可以在此模型基础上扩展。
"""

import json
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional, List
from dataclasses import dataclass, asdict


class RecordStatus(str, Enum):
    """记录点状态枚举"""
    STABLE = "稳定运行"
    TESTING = "测试中"
    MILESTONE = "里程碑"
    HOTFIX = "热修复"
    DEPLOYED = "已部署"
    COMPLETED = "已完成"


class RuleType(str, Enum):
    """规则类型枚举"""
    TASK_COMPLETION = "task_completion"
    TIME_INTERVAL = "time_interval"
    QUALITY_THRESHOLD = "quality_threshold"
    RISK_EVENT = "risk_event"
    MANUAL_REQUEST = "manual_request"


class RulePriority(str, Enum):
    """规则优先级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class StableRecordData:
    """稳定记录点数据结构（与文件系统存储格式兼容）"""
    record_id: str
    title: str
    status: str
    node: str
    saved_at: str
    saved_by: str
    reason: str
    trigger_rule: str
    confidence_score: float
    remark: str = ""
    task_id: str = ""
    task_code: str = ""
    git_commit: str = ""
    git_branch: str = ""
    extra_info: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        data = asdict(self)
        # 处理None值，确保JSON可序列化
        if data["extra_info"] is None:
            data["extra_info"] = {}
        return data

    def to_json(self, indent: int = 2) -> str:
        """转换为JSON字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StableRecordData":
        """从字典创建"""
        return cls(**data)

    @classmethod
    def from_json(cls, json_str: str) -> "StableRecordData":
        """从JSON字符串创建"""
        return cls.from_dict(json.loads(json_str))


@dataclass
class RuleDefinition:
    """规则定义数据结构"""
    rule_id: str
    rule_type: RuleType
    name: str
    description: str
    priority: RulePriority
    threshold: float  # 触发阈值 0-100
    enabled: bool = True
    config: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["rule_type"] = self.rule_type.value if isinstance(self.rule_type, RuleType) else self.rule_type
        data["priority"] = self.priority.value if isinstance(self.priority, RulePriority) else self.priority
        if data["config"] is None:
            data["config"] = {}
        return data


# 预设规则配置（可用于配置文件初始化）
DEFAULT_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "task_done",
        "rule_type": "task_completion",
        "name": "任务完成",
        "description": "当任务状态变为 Done 时自动创建记录点",
        "priority": "high",
        "threshold": 80.0,
        "config": {"target_state": "Done"}
    },
    {
        "rule_id": "milestone_reached",
        "rule_type": "task_completion",
        "name": "里程碑达成",
        "description": "当任务标题包含里程碑关键词时创建记录点",
        "priority": "medium",
        "threshold": 75.0,
        "config": {"milestone_keywords": ["完成", "里程碑", "交付", "上线", "修复完成"]}
    },
    {
        "rule_id": "time_interval_4h",
        "rule_type": "time_interval",
        "name": "4小时定时保存",
        "description": "每4小时且有活动时自动创建一次记录点",
        "priority": "low",
        "threshold": 50.0,
        "config": {"interval_hours": 4}
    },
    {
        "rule_id": "ci_success",
        "rule_type": "quality_threshold",
        "name": "CI测试通过",
        "description": "当CI测试全部通过且覆盖率达标时创建记录点",
        "priority": "medium",
        "threshold": 70.0,
        "config": {"min_coverage": 80}
    },
    {
        "rule_id": "hotfix_applied",
        "rule_type": "risk_event",
        "name": "热修复应用",
        "description": "当热修复或关键修复完成时创建记录点",
        "priority": "high",
        "threshold": 90.0,
        "config": {"keywords": ["hotfix", "修复", "bugfix", "紧急修复"]}
    },
    {
        "rule_id": "deploy_success",
        "rule_type": "risk_event",
        "name": "部署成功",
        "description": "当部署成功完成时创建记录点",
        "priority": "high",
        "threshold": 85.0,
        "config": {"deploy_status": "success"}
    },
]
