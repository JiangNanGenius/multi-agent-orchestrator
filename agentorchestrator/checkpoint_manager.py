"""
Agent自动化稳定记录点管理器
============================

提供Agent执行过程中的自动判断、保存、恢复、审计等功能。

核心功能：
1. 规则引擎：智能判断何时应该保存记录点
2. 触发机制：支持7种触发类型
3. 保存机制：完整记录执行上下文和决策轨迹
4. 恢复机制：从记录点恢复执行状态
5. 审计功能：完整的操作日志和防篡改校验
"""

import os
import json
import time
import uuid
import hashlib
import gzip
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict, field
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum


class TriggerType(Enum):
    """触发类型枚举"""
    TASK_SUCCESS = "task_success"       # 任务成功
    TASK_FAILURE = "task_failure"       # 任务失败
    CRITICAL_NODE = "critical_node"     # 关键节点
    USER_INSTRUCTION = "user_instruction"  # 用户指令
    TIMER = "timer"                     # 定时触发
    RESOURCE_THRESHOLD = "resource_threshold"  # 资源阈值
    CONTEXT_CHANGE = "context_change"   # 上下文变更
    MANUAL = "manual"                   # 手动触发


@dataclass
class ExecutionContext:
    """执行上下文"""
    current_step: str = ""
    step_history: List[Dict[str, Any]] = field(default_factory=list)
    context_variables: Dict[str, Any] = field(default_factory=dict)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    messages: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class DecisionTrace:
    """决策轨迹"""
    reasoning: str = ""
    alternatives: List[str] = field(default_factory=list)
    confidence_score: float = 0.0
    decision_factors: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EnvironmentState:
    """环境状态"""
    memory_usage_mb: float = 0.0
    execution_time_seconds: float = 0.0
    files_modified: List[str] = field(default_factory=list)
    workspace_snapshot: str = ""


@dataclass
class Artifacts:
    """产出物"""
    files: List[str] = field(default_factory=list)
    outputs: Dict[str, Any] = field(default_factory=dict)
    logs: str = ""


@dataclass
class Checkpoint:
    """记录点数据结构"""
    checkpoint_id: str = ""
    task_id: str = ""
    agent_id: str = ""
    timestamp: str = ""
    trigger_type: str = ""
    trigger_reason: str = ""
    execution_context: ExecutionContext = field(default_factory=ExecutionContext)
    decision_trace: DecisionTrace = field(default_factory=DecisionTrace)
    environment_state: EnvironmentState = field(default_factory=EnvironmentState)
    artifacts: Artifacts = field(default_factory=Artifacts)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.checkpoint_id:
            self.checkpoint_id = str(uuid.uuid4())
        if not self.timestamp:
            self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "checkpoint_id": self.checkpoint_id,
            "task_id": self.task_id,
            "agent_id": self.agent_id,
            "timestamp": self.timestamp,
            "trigger_type": self.trigger_type,
            "trigger_reason": self.trigger_reason,
            "execution_context": asdict(self.execution_context),
            "decision_trace": asdict(self.decision_trace),
            "environment_state": asdict(self.environment_state),
            "artifacts": asdict(self.artifacts),
            "metadata": {
                "version": "1.0",
                "schema_version": "1.0",
                "tags": [],
                **self.metadata
            }
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Checkpoint':
        """从字典创建"""
        return cls(
            checkpoint_id=data["checkpoint_id"],
            task_id=data["task_id"],
            agent_id=data["agent_id"],
            timestamp=data["timestamp"],
            trigger_type=data["trigger_type"],
            trigger_reason=data["trigger_reason"],
            execution_context=ExecutionContext(**data["execution_context"]),
            decision_trace=DecisionTrace(**data["decision_trace"]),
            environment_state=EnvironmentState(**data["environment_state"]),
            artifacts=Artifacts(**data["artifacts"]),
            metadata=data.get("metadata", {})
        )

    def calculate_hash(self) -> str:
        """计算记录点哈希值（用于防篡改校验）"""
        data = self.to_dict()
        # 排除metadata中的hash字段
        data.get("metadata", {}).pop("hash", None)
        json_str = json.dumps(data, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(json_str.encode('utf-8')).hexdigest()


class CheckpointRuleEngine:
    """规则引擎 - 判断何时应该保存记录点"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        # 默认权重配置
        self.weights = self.config.get("weights", {
            TriggerType.TASK_SUCCESS.value: 100,
            TriggerType.TASK_FAILURE.value: 100,
            TriggerType.CRITICAL_NODE.value: 80,
            TriggerType.USER_INSTRUCTION.value: 100,
            TriggerType.TIMER.value: 50,
            TriggerType.RESOURCE_THRESHOLD.value: 60,
            TriggerType.CONTEXT_CHANGE.value: 40,
        })
        self.threshold = self.config.get("threshold", 50)
        self.min_interval_seconds = self.config.get("min_interval_seconds", 30)
        self.last_save_time = 0.0

    def evaluate_task_completion(self, context: Dict[str, Any]) -> int:
        """评估任务完成情况"""
        score = 0
        if context.get("task_completed"):
            score += self.weights[TriggerType.TASK_SUCCESS.value]
        if context.get("task_failed") or context.get("error_occurred"):
            score += self.weights[TriggerType.TASK_FAILURE.value]
        return score

    def evaluate_critical_node(self, context: Dict[str, Any]) -> int:
        """评估是否在关键节点"""
        score = 0
        if context.get("is_critical_node"):
            score += self.weights[TriggerType.CRITICAL_NODE.value]
        if context.get("milestone_reached"):
            score += 70  # 里程碑达到
        return score

    def evaluate_user_instruction(self, context: Dict[str, Any]) -> int:
        """评估用户指令"""
        score = 0
        if context.get("user_requested_checkpoint"):
            score += self.weights[TriggerType.USER_INSTRUCTION.value]
        return score

    def evaluate_timer(self, context: Dict[str, Any]) -> int:
        """评估定时触发"""
        score = 0
        elapsed = context.get("elapsed_since_last_checkpoint", 0)
        timer_interval = context.get("timer_interval", 300)  # 默认5分钟
        if elapsed >= timer_interval:
            score += self.weights[TriggerType.TIMER.value]
        return score

    def evaluate_resource_threshold(self, context: Dict[str, Any]) -> int:
        """评估资源阈值"""
        score = 0
        memory_mb = context.get("memory_usage_mb", 0)
        memory_threshold = context.get("memory_threshold_mb", 2000)
        exec_time = context.get("execution_time_seconds", 0)
        time_threshold = context.get("time_threshold_seconds", 3600)

        if memory_mb >= memory_threshold:
            score += 40
        if exec_time >= time_threshold:
            score += 30
        return score

    def evaluate_context_change(self, context: Dict[str, Any]) -> int:
        """评估上下文变更程度"""
        score = 0
        change_magnitude = context.get("context_change_magnitude", 0)
        if change_magnitude > 0.5:  # 变化超过50%
            score += self.weights[TriggerType.CONTEXT_CHANGE.value]
        elif change_magnitude > 0.3:
            score += 30
        return score

    def should_save(self, context: Dict[str, Any]) -> Tuple[bool, int, List[str]]:
        """
        判断是否应该保存记录点

        Returns:
            (是否应该保存, 总得分, 触发原因列表)
        """
        # 检查最小时间间隔
        now = time.time()
        if now - self.last_save_time < self.min_interval_seconds:
            return False, 0, ["too_recent"]

        reasons = []
        total_score = 0

        # 逐项评估
        scores = {
            "task_completion": self.evaluate_task_completion(context),
            "critical_node": self.evaluate_critical_node(context),
            "user_instruction": self.evaluate_user_instruction(context),
            "timer": self.evaluate_timer(context),
            "resource_threshold": self.evaluate_resource_threshold(context),
            "context_change": self.evaluate_context_change(context),
        }

        for reason, score in scores.items():
            if score > 0:
                reasons.append(reason)
                total_score += score

        should_save = total_score >= self.threshold

        if should_save:
            self.last_save_time = now

        return should_save, total_score, reasons

    def get_trigger_type(self, reasons: List[str]) -> TriggerType:
        """根据触发原因确定触发类型"""
        if "task_completion" in reasons:
            if "task_failed" in reasons or "error_occurred" in reasons:
                return TriggerType.TASK_FAILURE
            return TriggerType.TASK_SUCCESS
        if "critical_node" in reasons:
            return TriggerType.CRITICAL_NODE
        if "user_instruction" in reasons:
            return TriggerType.USER_INSTRUCTION
        if "timer" in reasons:
            return TriggerType.TIMER
        if "resource_threshold" in reasons:
            return TriggerType.RESOURCE_THRESHOLD
        if "context_change" in reasons:
            return TriggerType.CONTEXT_CHANGE
        return TriggerType.MANUAL


class CheckpointManager:
    """记录点管理器 - 核心功能实现"""

    def __init__(self, base_path: Optional[str] = None):
        """
        初始化记录点管理器

        Args:
            base_path: 工作区基础路径，默认为当前目录
        """
        if base_path:
            self.base_path = Path(base_path)
        else:
            self.base_path = Path.cwd()

        self.checkpoints_dir = self.base_path / "context" / "snapshots"
        self.checkpoints_dir.mkdir(parents=True, exist_ok=True)

        self.index_file = self.checkpoints_dir / "index.json"
        self.audit_file = self.base_path / "ledger" / "checkpoint_audit.jsonl"
        self.audit_file.parent.mkdir(parents=True, exist_ok=True)

        self.rule_engine = CheckpointRuleEngine()

        # 内存中的记录点索引
        self._index: List[Dict[str, Any]] = []
        self._load_index()

    def _load_index(self):
        """加载索引文件"""
        if self.index_file.exists():
            try:
                with open(self.index_file, 'r', encoding='utf-8') as f:
                    self._index = json.load(f)
            except Exception:
                self._index = []

    def _save_index(self):
        """保存索引文件"""
        with open(self.index_file, 'w', encoding='utf-8') as f:
            json.dump(self._index, f, ensure_ascii=False, indent=2)

    def _audit_log(self, action: str, checkpoint_id: str, details: Dict[str, Any]):
        """记录审计日志"""
        audit_entry = {
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "checkpoint_id": checkpoint_id,
            "details": details
        }
        with open(self.audit_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(audit_entry, ensure_ascii=False) + '\n')

    async def save_checkpoint(
        self,
        task_id: str,
        agent_id: str,
        trigger_type: TriggerType,
        trigger_reason: str,
        execution_context: ExecutionContext,
        decision_trace: Optional[DecisionTrace] = None,
        environment_state: Optional[EnvironmentState] = None,
        artifacts: Optional[Artifacts] = None,
        compress: bool = False,
    ) -> Checkpoint:
        """
        保存记录点

        Args:
            task_id: 任务ID
            agent_id: Agent ID
            trigger_type: 触发类型
            trigger_reason: 触发原因说明
            execution_context: 执行上下文
            decision_trace: 决策轨迹
            environment_state: 环境状态
            artifacts: 产出物
            compress: 是否压缩存储

        Returns:
            保存的Checkpoint对象
        """
        checkpoint = Checkpoint(
            task_id=task_id,
            agent_id=agent_id,
            trigger_type=trigger_type.value,
            trigger_reason=trigger_reason,
            execution_context=execution_context,
            decision_trace=decision_trace or DecisionTrace(),
            environment_state=environment_state or EnvironmentState(),
            artifacts=artifacts or Artifacts(),
        )

        # 计算并存储哈希值
        checkpoint_hash = checkpoint.calculate_hash()
        checkpoint.metadata["hash"] = checkpoint_hash

        # 保存到文件
        checkpoint_data = checkpoint.to_dict()
        filename = f"checkpoint_{checkpoint.timestamp.replace(':', '-')}_{checkpoint.checkpoint_id[:8]}.json"

        if compress:
            filename += ".gz"
            with gzip.open(self.checkpoints_dir / filename, 'wt', encoding='utf-8') as f:
                json.dump(checkpoint_data, f, ensure_ascii=False, indent=2)
        else:
            with open(self.checkpoints_dir / filename, 'w', encoding='utf-8') as f:
                json.dump(checkpoint_data, f, ensure_ascii=False, indent=2)

        # 更新索引
        index_entry = {
            "checkpoint_id": checkpoint.checkpoint_id,
            "task_id": task_id,
            "agent_id": agent_id,
            "timestamp": checkpoint.timestamp,
            "trigger_type": trigger_type.value,
            "filename": filename,
            "compressed": compress,
        }
        self._index.append(index_entry)
        self._save_index()

        # 记录审计日志
        self._audit_log("save", checkpoint.checkpoint_id, {
            "trigger_type": trigger_type.value,
            "trigger_reason": trigger_reason,
            "filename": filename,
        })

        return checkpoint

    async def list_checkpoints(self, task_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        列出记录点

        Args:
            task_id: 可选，按任务ID过滤

        Returns:
            记录点索引列表（按时间倒序）
        """
        checkpoints = list(self._index)

        if task_id:
            checkpoints = [cp for cp in checkpoints if cp["task_id"] == task_id]

        # 按时间倒序排列
        checkpoints.sort(key=lambda x: x["timestamp"], reverse=True)

        return checkpoints

    async def load_checkpoint(self, checkpoint_id: str) -> Optional[Checkpoint]:
        """
        加载记录点

        Args:
            checkpoint_id: 记录点ID

        Returns:
            Checkpoint对象，如果不存在返回None
        """
        # 查找索引
        index_entry = None
        for entry in self._index:
            if entry["checkpoint_id"] == checkpoint_id:
                index_entry = entry
                break

        if not index_entry:
            return None

        # 读取文件
        filepath = self.checkpoints_dir / index_entry["filename"]

        if index_entry.get("compressed"):
            with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                data = json.load(f)
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)

        # 验证哈希
        checkpoint = Checkpoint.from_dict(data)
        calculated_hash = checkpoint.calculate_hash()
        stored_hash = checkpoint.metadata.get("hash", "")

        if calculated_hash != stored_hash:
            self._audit_log("tamper_detected", checkpoint_id, {
                "calculated_hash": calculated_hash,
                "stored_hash": stored_hash,
            })
            raise ValueError(f"记录点 {checkpoint_id} 数据可能被篡改！")

        self._audit_log("load", checkpoint_id, {})

        return checkpoint

    async def restore_checkpoint(self, checkpoint_id: str) -> Optional[ExecutionContext]:
        """
        从记录点恢复执行上下文

        Args:
            checkpoint_id: 记录点ID

        Returns:
            恢复的执行上下文
        """
        checkpoint = await self.load_checkpoint(checkpoint_id)
        if not checkpoint:
            return None

        self._audit_log("restore", checkpoint_id, {
            "agent_id": checkpoint.agent_id,
            "task_id": checkpoint.task_id,
        })

        return checkpoint.execution_context

    async def delete_checkpoint(self, checkpoint_id: str) -> bool:
        """
        删除记录点

        Args:
            checkpoint_id: 记录点ID

        Returns:
            是否删除成功
        """
        index_entry = None
        for i, entry in enumerate(self._index):
            if entry["checkpoint_id"] == checkpoint_id:
                index_entry = entry
                index_pos = i
                break

        if not index_entry:
            return False

        # 删除文件
        filepath = self.checkpoints_dir / index_entry["filename"]
        if filepath.exists():
            filepath.unlink()

        # 从索引中移除
        self._index.pop(index_pos)
        self._save_index()

        self._audit_log("delete", checkpoint_id, {
            "filename": index_entry["filename"],
        })

        return True

    async def diff_checkpoints(self, cp1_id: str, cp2_id: str) -> Dict[str, Any]:
        """
        对比两个记录点的差异

        Args:
            cp1_id: 记录点1的ID
            cp2_id: 记录点2的ID

        Returns:
            差异分析结果
        """
        cp1 = await self.load_checkpoint(cp1_id)
        cp2 = await self.load_checkpoint(cp2_id)

        if not cp1 or not cp2:
            return {"error": "checkpoint_not_found"}

        # 简单的差异对比
        diff = {
            "checkpoint1": {
                "id": cp1.checkpoint_id,
                "timestamp": cp1.timestamp,
                "trigger_type": cp1.trigger_type,
            },
            "checkpoint2": {
                "id": cp2.checkpoint_id,
                "timestamp": cp2.timestamp,
                "trigger_type": cp2.trigger_type,
            },
            "time_diff_seconds": (
                datetime.fromisoformat(cp2.timestamp) -
                datetime.fromisoformat(cp1.timestamp)
            ).total_seconds(),
            "steps_added": len(cp2.execution_context.step_history) -
                           len(cp1.execution_context.step_history),
            "context_changes": {},  # 可扩展详细对比
        }

        return diff

    def should_autosave(self, context: Dict[str, Any]) -> Tuple[bool, TriggerType, str]:
        """
        判断是否应该自动保存记录点（便捷方法）

        Args:
            context: 当前执行上下文信息

        Returns:
            (是否应该保存, 触发类型, 触发原因)
        """
        should_save, score, reasons = self.rule_engine.should_save(context)

        if not should_save:
            return False, TriggerType.MANUAL, ""

        trigger_type = self.rule_engine.get_trigger_type(reasons)
        reason = f"自动触发，得分: {score}, 原因: {', '.join(reasons)}"

        return True, trigger_type, reason


# 便捷函数
def create_checkpoint_manager(workspace_path: str) -> CheckpointManager:
    """创建记录点管理器实例"""
    return CheckpointManager(workspace_path)


if __name__ == "__main__":
    print("✅ Agent自动化稳定记录点管理器已加载")
    print(f"📁 默认工作区: {Path.cwd()}")
