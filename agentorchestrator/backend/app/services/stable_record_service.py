"""
稳定记录点服务
提供 Agent 自主决策保存稳定记录点的能力
包含：规则引擎、触发条件评估器、决策模块、保存接口
"""

import json
import os
import time
import asyncio
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable, Tuple
from dataclasses import dataclass, field
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class RuleType(Enum):
    """规则类型"""
    TASK_COMPLETION = "task_completion"      # 任务完成度规则
    TIME_INTERVAL = "time_interval"          # 时间间隔规则
    QUALITY_THRESHOLD = "quality_threshold"  # 质量阈值规则
    RISK_EVENT = "risk_event"                # 风险事件规则
    USER_REQUEST = "user_request"            # 用户显式请求


class TriggerSource(Enum):
    """触发源"""
    TASK_STATE_CHANGE = "task_state_change"    # 任务状态变更
    PROGRESS_UPDATE = "progress_update"        # 进度更新
    CODE_COMMIT = "code_commit"                # 代码提交
    CI_RESULT = "ci_result"                    # CI结果
    SYSTEM_HEALTH = "system_health"            # 系统健康指标
    USER_SIGNAL = "user_signal"                # 用户行为信号


@dataclass
class Rule:
    """规则定义"""
    rule_id: str
    rule_type: RuleType
    name: str
    description: str
    weight: float = 1.0
    enabled: bool = True
    condition: Dict[str, Any] = field(default_factory=dict)
    action: str = "create_record"
    config: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TriggerSignal:
    """触发信号"""
    source: TriggerSource
    timestamp: float = field(default_factory=time.time)
    data: Dict[str, Any] = field(default_factory=dict)
    task_id: Optional[str] = None
    workspace: Optional[str] = None


@dataclass
class DecisionResult:
    """决策结果"""
    should_create: bool
    confidence: float
    triggered_rules: List[str]
    reason: str
    auto_save: bool = True
    require_confirmation: bool = False
    recommended_title: Optional[str] = None
    recommended_status: Optional[str] = None


class RuleEngine:
    """规则引擎"""

    def __init__(self, config_path: Optional[str] = None):
        self.rules: Dict[str, Rule] = {}
        self.config_path = config_path or os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "config", "stable_record_rules.json"
        )
        self._load_default_rules()
        self._load_rules()

    def _load_default_rules(self):
        """加载默认规则"""
        default_rules = [
            Rule(
                rule_id="task_done",
                rule_type=RuleType.TASK_COMPLETION,
                name="任务完成",
                description="当任务状态变为 Done 时自动创建记录点",
                weight=2.0,
                condition={"state": "Done"},
            ),
            Rule(
                rule_id="milestone_reached",
                rule_type=RuleType.TASK_COMPLETION,
                name="里程碑达成",
                description="当子任务完成度超过 80% 时创建记录点",
                weight=1.5,
                condition={"completion_rate": 0.8},
            ),
            Rule(
                rule_id="time_interval_1h",
                rule_type=RuleType.TIME_INTERVAL,
                name="每小时记录",
                description="距离上次记录超过 1 小时且有活动时创建",
                weight=0.5,
                condition={"interval_seconds": 3600},
            ),
            Rule(
                rule_id="time_interval_4h",
                rule_type=RuleType.TIME_INTERVAL,
                name="每4小时强制记录",
                description="距离上次记录超过 4 小时强制创建",
                weight=3.0,
                condition={"interval_seconds": 14400, "force": True},
            ),
            Rule(
                rule_id="ci_success",
                rule_type=RuleType.QUALITY_THRESHOLD,
                name="CI 通过",
                description="CI 测试全部通过时创建记录点",
                weight=1.5,
                condition={"ci_status": "success"},
            ),
            Rule(
                rule_id="test_coverage_high",
                rule_type=RuleType.QUALITY_THRESHOLD,
                name="测试覆盖率达标",
                description="测试覆盖率超过 90% 时创建记录点",
                weight=1.0,
                condition={"coverage": 0.9},
            ),
            Rule(
                rule_id="critical_fix",
                rule_type=RuleType.RISK_EVENT,
                name="关键问题修复",
                description="修复严重级别问题后创建记录点",
                weight=2.5,
                condition={"severity": "critical"},
            ),
            Rule(
                rule_id="deploy_success",
                rule_type=RuleType.RISK_EVENT,
                name="部署成功",
                description="部署成功后创建记录点",
                weight=2.0,
                condition={"deploy_status": "success"},
            ),
        ]

        for rule in default_rules:
            self.rules[rule.rule_id] = rule

    def _load_rules(self):
        """从配置文件加载规则"""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                for rule_data in config.get("rules", []):
                    rule = Rule(
                        rule_id=rule_data["rule_id"],
                        rule_type=RuleType(rule_data["rule_type"]),
                        name=rule_data["name"],
                        description=rule_data["description"],
                        weight=rule_data.get("weight", 1.0),
                        enabled=rule_data.get("enabled", True),
                        condition=rule_data.get("condition", {}),
                        action=rule_data.get("action", "create_record"),
                        config=rule_data.get("config", {}),
                    )
                    self.rules[rule.rule_id] = rule
                logger.info(f"已加载 {len(self.rules)} 条规则")
            except Exception as e:
                logger.warning(f"加载规则配置失败: {e}，使用默认规则")

    def add_rule(self, rule: Rule):
        """添加规则"""
        self.rules[rule.rule_id] = rule

    def remove_rule(self, rule_id: str):
        """移除规则"""
        self.rules.pop(rule_id, None)

    def get_enabled_rules(self) -> List[Rule]:
        """获取所有启用的规则"""
        return [r for r in self.rules.values() if r.enabled]


class TriggerEvaluator:
    """触发条件评估器"""

    def __init__(self, rule_engine: RuleEngine):
        self.rule_engine = rule_engine
        self.last_evaluation: float = 0
        self.evaluation_cooldown: int = 60  # 60秒冷却，防止频繁评估

    def evaluate_signal(self, signal: TriggerSignal, context: Dict[str, Any]) -> DecisionResult:
        """评估触发信号"""
        now = time.time()
        if now - self.last_evaluation < self.evaluation_cooldown:
            return DecisionResult(
                should_create=False,
                confidence=0.0,
                triggered_rules=[],
                reason="评估冷却期，跳过本次评估"
            )

        self.last_evaluation = now

        total_score = 0.0
        triggered_rules = []
        reasons = []

        rules = self.rule_engine.get_enabled_rules()

        for rule in rules:
            matched, score = self._match_rule(rule, signal, context)
            if matched:
                total_score += score
                triggered_rules.append(rule.rule_id)
                reasons.append(f"{rule.name} (权重: {rule.weight})")

        threshold = context.get("decision_threshold", 1.5)
        should_create = total_score >= threshold

        # 检查是否有强制规则触发
        force_rules = [r for r in triggered_rules if self.rules[r].condition.get("force")]
        if force_rules:
            should_create = True
            reasons.append("强制规则触发")

        return DecisionResult(
            should_create=should_create,
            confidence=min(total_score / threshold, 1.0) if threshold > 0 else 0,
            triggered_rules=triggered_rules,
            reason="; ".join(reasons) if reasons else "无匹配规则",
            auto_save=should_create and total_score >= threshold * 1.5,
            require_confirmation=should_create and total_score < threshold * 1.2,
            recommended_title=self._generate_title(signal, context),
            recommended_status=self._determine_status(signal, context),
        )

    def _match_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配单个规则，返回(是否匹配, 得分)"""
        condition = rule.condition

        if rule.rule_type == RuleType.TASK_COMPLETION:
            return self._match_task_completion_rule(rule, signal, context)
        elif rule.rule_type == RuleType.TIME_INTERVAL:
            return self._match_time_interval_rule(rule, signal, context)
        elif rule.rule_type == RuleType.QUALITY_THRESHOLD:
            return self._match_quality_threshold_rule(rule, signal, context)
        elif rule.rule_type == RuleType.RISK_EVENT:
            return self._match_risk_event_rule(rule, signal, context)
        elif rule.rule_type == RuleType.USER_REQUEST:
            return self._match_user_request_rule(rule, signal, context)

        return False, 0.0

    def _match_task_completion_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配任务完成度规则"""
        condition = rule.condition

        if "state" in condition:
            if context.get("task_state") == condition["state"]:
                return True, rule.weight

        if "completion_rate" in condition:
            completion_rate = context.get("completion_rate", 0)
            if completion_rate >= condition["completion_rate"]:
                return True, rule.weight * min(completion_rate, 1.0)

        return False, 0.0

    def _match_time_interval_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配时间间隔规则"""
        condition = rule.condition
        last_record_time = context.get("last_record_time", 0)
        has_activity = context.get("has_activity", False)

        interval = condition.get("interval_seconds", 3600)
        time_passed = time.time() - last_record_time

        if condition.get("force") and time_passed >= interval:
            return True, rule.weight

        if time_passed >= interval and has_activity:
            return True, rule.weight * min(time_passed / interval, 1.5)

        return False, 0.0

    def _match_quality_threshold_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配质量阈值规则"""
        condition = rule.condition

        if "ci_status" in condition:
            if context.get("ci_status") == condition["ci_status"]:
                return True, rule.weight

        if "coverage" in condition:
            coverage = context.get("test_coverage", 0)
            if coverage >= condition["coverage"]:
                return True, rule.weight * min(coverage, 1.0)

        return False, 0.0

    def _match_risk_event_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配风险事件规则"""
        condition = rule.condition

        if "severity" in condition:
            if context.get("issue_severity") == condition["severity"]:
                return True, rule.weight

        if "deploy_status" in condition:
            if context.get("deploy_status") == condition["deploy_status"]:
                return True, rule.weight

        return False, 0.0

    def _match_user_request_rule(self, rule: Rule, signal: TriggerSignal, context: Dict[str, Any]) -> tuple[bool, float]:
        """匹配用户请求规则"""
        if context.get("user_requested"):
            return True, rule.weight * 2.0
        return False, 0.0

    def _generate_title(self, signal: TriggerSignal, context: Dict[str, Any]) -> str:
        """生成记录点标题"""
        task_id = context.get("task_id", "")
        task_code = context.get("task_code", "")
        task_title = context.get("task_title", "")

        if signal.source == TriggerSource.TASK_STATE_CHANGE:
            state = context.get("task_state", "")
            return f"任务状态变更: {task_code or task_id} -> {state}"
        elif signal.source == TriggerSource.CI_RESULT:
            return f"CI 执行结果: {context.get('ci_status', 'unknown')}"
        elif signal.source == TriggerSource.CODE_COMMIT:
            return f"代码提交: {context.get('commit_message', '')[:50]}"
        else:
            return f"自动记录点: {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    def _determine_status(self, signal: TriggerSignal, context: Dict[str, Any]) -> str:
        """确定记录点状态"""
        ci_status = context.get("ci_status")
        if ci_status == "success":
            return "稳定运行"
        elif ci_status == "failed":
            return "需要关注"

        task_state = context.get("task_state")
        if task_state == "Done":
            return "已完成"

        return "进行中"

    @property
    def rules(self) -> Dict[str, Rule]:
        return self.rule_engine.rules


class WorkspaceSnapshot:
    """工作区快照"""

    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.snapshot_dir = os.path.join(workspace_path, "context", "snapshots")
        os.makedirs(self.snapshot_dir, exist_ok=True)

    def create_snapshot(self, record_id: str, context: Dict[str, Any]) -> str:
        """创建工作区快照"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        snapshot_name = f"snapshot_{record_id}_{timestamp}.json"
        snapshot_path = os.path.join(self.snapshot_dir, snapshot_name)

        snapshot = {
            "record_id": record_id,
            "created_at": datetime.now().isoformat(),
            "workspace_path": self.workspace_path,
            "context": context,
            "files": self._capture_file_state(),
            "git_info": self._capture_git_info(),
        }

        with open(snapshot_path, 'w', encoding='utf-8') as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)

        return snapshot_path

    def _capture_file_state(self) -> Dict[str, Any]:
        """捕获关键文件状态"""
        key_files = [
            "README.md",
            "PLAN.md",
            "TODO.md",
            "HANDOFF.md",
            "TASK_RECORD.json",
            "STATUS.json",
        ]

        file_states = {}
        for filename in key_files:
            filepath = os.path.join(self.workspace_path, filename)
            if os.path.exists(filepath):
                stat = os.stat(filepath)
                file_states[filename] = {
                    "exists": True,
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                }
            else:
                file_states[filename] = {"exists": False}

        return file_states

    def _capture_git_info(self) -> Dict[str, Any]:
        """捕获 Git 信息"""
        try:
            import subprocess
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.workspace_path,
                capture_output=True,
                text=True,
                timeout=5,
            )
            commit_hash = result.stdout.strip() if result.returncode == 0 else None

            result = subprocess.run(
                ["git", "status", "--short"],
                cwd=self.workspace_path,
                capture_output=True,
                text=True,
                timeout=5,
            )
            git_status = result.stdout.strip() if result.returncode == 0 else None

            return {
                "commit_hash": commit_hash,
                "has_changes": bool(git_status),
                "status": git_status,
            }
        except Exception:
            return {"error": "Git not available"}

    def get_snapshot(self, record_id: str) -> Optional[Dict[str, Any]]:
        """获取指定记录的快照"""
        for f in os.listdir(self.snapshot_dir):
            if record_id in f and f.endswith('.json'):
                with open(os.path.join(self.snapshot_dir, f), 'r', encoding='utf-8') as fp:
                    return json.load(fp)
        return None


class RecordPointManager:
    """记录点管理器"""

    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.records_dir = os.path.join(workspace_path, "artifacts", "stable_records")
        os.makedirs(self.records_dir, exist_ok=True)

        self.rule_engine = RuleEngine()
        self.evaluator = TriggerEvaluator(self.rule_engine)
        self.snapshot = WorkspaceSnapshot(workspace_path)

        self.last_record_time: float = 0
        self._load_last_record_time()

    def _load_last_record_time(self):
        """加载最近记录时间"""
        if not os.path.exists(self.records_dir):
            return

        records = []
        for f in os.listdir(self.records_dir):
            if f.endswith('.json'):
                filepath = os.path.join(self.records_dir, f)
                records.append((os.path.getmtime(filepath), filepath))

        if records:
            records.sort(reverse=True)
            self.last_record_time = records[0][0]

    async def evaluate_and_create(self, signal: TriggerSignal, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """评估并可能创建记录点"""
        # 补充上下文信息
        context["last_record_time"] = self.last_record_time
        context["workspace_path"] = self.workspace_path

        # 评估决策
        decision = self.evaluator.evaluate_signal(signal, context)

        if not decision.should_create:
            logger.info(f"不创建记录点: {decision.reason}")
            return None

        logger.info(f"决定创建记录点: {decision.reason}, 置信度: {decision.confidence:.2f}")

        # 如果需要确认，返回待确认状态
        if decision.require_confirmation:
            logger.info("需要用户确认，暂不自动创建")
            return {
                "decision": decision.__dict__,
                "status": "pending_confirmation",
            }

        # 创建记录点
        record = await self._create_record(decision, signal, context)
        return record

    async def _create_record(self, decision: DecisionResult, signal: TriggerSignal, context: Dict[str, Any]) -> Dict[str, Any]:
        """创建记录点"""
        timestamp = datetime.now()
        record_id = f"STABLE_{timestamp.strftime('%Y%m%d_%H%M%S')}"

        title = decision.recommended_title or "自动稳定记录点"
        status = decision.recommended_status or "稳定运行"

        record = {
            "record_id": record_id,
            "title": title,
            "status": status,
            "created_at": timestamp.isoformat(),
            "created_by": "auto_decision_engine",
            "source": signal.source.value,
            "task_id": context.get("task_id"),
            "task_code": context.get("task_code"),
            "triggered_rules": decision.triggered_rules,
            "reason": decision.reason,
            "confidence": decision.confidence,
            "auto_saved": decision.auto_save,
            "context_snapshot": self._extract_context(context),
        }

        # 保存记录文件
        filename = f"{timestamp.strftime('%Y%m%d_%H%M%S')}_{title.replace(' ', '_')[:30]}.json"
        filepath = os.path.join(self.records_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        # 创建工作区快照
        try:
            snapshot_path = self.snapshot.create_snapshot(record_id, context)
            record["snapshot_path"] = snapshot_path
        except Exception as e:
            logger.warning(f"创建工作区快照失败: {e}")

        self.last_record_time = time.time()

        logger.info(f"✅ 稳定记录点已创建: {record_id}")
        return record

    def _extract_context(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """提取关键上下文信息"""
        keys = [
            "task_id", "task_code", "task_title", "task_state",
            "completion_rate", "ci_status", "test_coverage",
            "deploy_status", "issue_severity", "has_activity",
        ]
        return {k: context.get(k) for k in keys if context.get(k) is not None}

    def list_records(self, limit: int = 20) -> List[Dict[str, Any]]:
        """列出记录点"""
        if not os.path.exists(self.records_dir):
            return []

        records = []
        for f in os.listdir(self.records_dir):
            if f.endswith('.json'):
                filepath = os.path.join(self.records_dir, f)
                with open(filepath, 'r', encoding='utf-8') as fp:
                    records.append(json.load(fp))

        records.sort(key=lambda x: x["created_at"], reverse=True)
        return records[:limit]

    def get_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        """获取单个记录"""
        for f in os.listdir(self.records_dir):
            if f.endswith('.json'):
                filepath = os.path.join(self.records_dir, f)
                with open(filepath, 'r', encoding='utf-8') as fp:
                    record = json.load(fp)
                    if record.get("record_id") == record_id:
                        return record
        return None


# 全局管理器实例
_managers: Dict[str, RecordPointManager] = {}

def get_record_manager(workspace_path: str) -> RecordPointManager:
    """获取记录点管理器"""
    if workspace_path not in _managers:
        _managers[workspace_path] = RecordPointManager(workspace_path)
    return _managers[workspace_path]


# ============================================
# 兼容层：StableRecordService (供 scripts 使用)
# ============================================

class RecordStatus(str, Enum):
    """记录点状态 - 兼容枚举"""
    STABLE = "稳定运行"
    TESTING = "测试中"
    MILESTONE = "里程碑"
    HOTFIX = "热修复"
    DEPLOYED = "已部署"


class RulePriority(int, Enum):
    """规则优先级 - 兼容枚举"""
    LOW = 1
    MEDIUM = 2
    HIGH = 3


@dataclass
class StableRecord:
    """稳定记录点 - 兼容数据类"""
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
    extra_info: Dict[str, Any] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "title": self.title,
            "status": self.status,
            "node": self.node,
            "saved_at": self.saved_at,
            "saved_by": self.saved_by,
            "reason": self.reason,
            "trigger_rule": self.trigger_rule,
            "confidence_score": self.confidence_score,
            "remark": self.remark,
            "task_id": self.task_id,
            "task_code": self.task_code,
            "git_commit": self.git_commit,
            "git_branch": self.git_branch,
            "extra_info": self.extra_info or {},
        }


class StableRecordService:
    """稳定记录点服务 - 兼容层

    提供与 scripts/stable_record.py 期望的接口一致的API，
    底层使用 RecordPointManager 实现功能。
    """

    def __init__(self, records_dir: Optional[str] = None):
        self.project_root = Path(os.environ.get("AGENTORCHESTRATOR_HOME", Path.cwd())).resolve()
        self.records_dir = Path(records_dir) if records_dir else self.project_root / "stable_records"
        self.records_dir.mkdir(parents=True, exist_ok=True)
        self.rule_engine = RuleEngine()
        self.debounce_minutes = 30
        self.last_record_time: Dict[str, datetime] = {}

    @property
    def rules(self) -> List[Rule]:
        """获取所有规则"""
        return list(self.rule_engine.rules.values())

    def _get_git_info(self) -> Tuple[str, str]:
        """获取Git信息"""
        try:
            import subprocess
            commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=str(self.project_root),
                text=True,
                timeout=5
            ).strip()
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=str(self.project_root),
                text=True,
                timeout=5
            ).strip()
            return commit, branch
        except Exception:
            return "", ""

    def _evaluate_rule(self, rule: Rule, context: Dict[str, Any]) -> float:
        """评估单个规则"""
        score = 0.0

        if rule.rule_type == RuleType.TASK_COMPLETION:
            if context.get("task_state") == "Done":
                score = 95.0
            elif context.get("task_progress", 0) >= 80:
                score = 70.0
            title = context.get("task_title", "")
            keywords = ["完成", "里程碑", "交付", "上线", "修复"]
            if any(kw in title for kw in keywords):
                score = max(score, 85.0)

        elif rule.rule_type == RuleType.TIME_INTERVAL:
            if context.get("last_record_time"):
                elapsed = time.time() - context["last_record_time"]
                if elapsed >= 4 * 3600:
                    score = 60.0
            else:
                score = 30.0

        elif rule.rule_type == RuleType.QUALITY_THRESHOLD:
            if context.get("ci_passed"):
                score = 85.0
            if context.get("test_coverage", 0) >= 80:
                score = max(score, 75.0)

        elif rule.rule_type == RuleType.RISK_EVENT:
            event_type = context.get("event_type") or ""
            message = context.get("message") or ""
            if "hotfix" in event_type or "修复" in message:
                score = 90.0
            elif "deploy" in event_type:
                score = 85.0

        elif "USER_REQUEST" in str(rule.rule_type) or context.get("manual_request"):
            score = 100.0

        return min(score, 100.0)

    def evaluate_all_rules(self, context: Dict[str, Any]) -> List[Tuple[Rule, float]]:
        """评估所有规则"""
        results = []
        for rule in self.rule_engine.get_enabled_rules():
            score = self._evaluate_rule(rule, context)
            if score > 0:
                results.append((rule, score))
        return results

    def should_create_record(self, context: Dict[str, Any]) -> Tuple[bool, float, List[str]]:
        """判断是否应该创建记录点"""
        task_id = context.get("task_id", "")

        # 防抖检查
        if task_id and task_id in self.last_record_time:
            elapsed = datetime.now() - self.last_record_time[task_id]
            if elapsed < timedelta(minutes=self.debounce_minutes):
                return False, 0.0, []

        # 人工请求直接通过
        if context.get("manual_request"):
            return True, 100.0, ["manual_request"]

        rule_scores = self.evaluate_all_rules(context)
        if not rule_scores:
            return False, 0.0, []

        # 计算加权分数
        weighted_sum = 0.0
        total_weight = 0
        triggered_rules = []

        for rule, score in rule_scores:
            # 使用配置中的阈值
            threshold = getattr(rule, 'threshold', 60.0)
            if score >= threshold:
                weight = getattr(rule, 'weight', 1.0) * 2
                weighted_sum += score * weight
                total_weight += weight
                triggered_rules.append(rule.rule_id)

        if total_weight == 0:
            return False, 0.0, []

        confidence = weighted_sum / total_weight
        should_create = confidence >= 50.0

        return should_create, confidence, triggered_rules

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
    ) -> StableRecord:
        """创建记录点"""
        timestamp = datetime.now()
        record_id = f"STABLE_{timestamp.strftime('%Y%m%d_%H%M%S')}"

        git_commit, git_branch = self._get_git_info()

        record = StableRecord(
            record_id=record_id,
            title=title,
            status=status,
            node=node,
            saved_at=timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            saved_by="auto_service",
            reason=reason,
            trigger_rule=trigger_rule,
            confidence_score=round(confidence_score, 2),
            remark=remark,
            task_id=task_id,
            task_code=task_code,
            git_commit=git_commit,
            git_branch=git_branch,
            extra_info=extra_info
        )

        # 保存到文件
        filename = f"{timestamp.strftime('%Y%m%d_%H%M%S')}_{title.replace(' ', '_')[:30]}.json"
        filepath = self.records_dir / filename

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(record.to_dict(), f, ensure_ascii=False, indent=2)

        # 更新防抖时间
        if task_id:
            self.last_record_time[task_id] = datetime.now()

        return record

    def auto_create_if_needed(
        self,
        task_id: str,
        context: Dict[str, Any],
        default_title: Optional[str] = None
    ) -> Tuple[bool, Optional[StableRecord]]:
        """自动判断并创建记录点"""
        context["task_id"] = task_id

        should_create, confidence, triggered_rules = self.should_create_record(context)

        if not should_create:
            return False, None

        # 确定标题
        if default_title:
            title = default_title
        else:
            task_title = context.get("task_title", "")
            if task_title:
                title = f"{task_title} - 稳定记录"
            else:
                title = f"任务稳定记录 - {datetime.now().strftime('%m-%d %H:%M')}"

        # 确定原因
        if triggered_rules:
            reason = f"触发规则: {', '.join(triggered_rules)}"
        else:
            reason = "系统自动判断"

        record = self.create_record(
            title=title,
            status=context.get("status", RecordStatus.STABLE),
            node=context.get("node", "system"),
            reason=reason,
            trigger_rule=",".join(triggered_rules),
            confidence_score=confidence,
            task_id=task_id,
            task_code=context.get("task_code", ""),
            extra_info=context.get("extra_info")
        )

        return True, record

    def list_records(self, limit: int = 20, task_id: Optional[str] = None) -> List[StableRecord]:
        """列出记录点"""
        records = []

        for filepath in sorted(self.records_dir.glob("*.json"), reverse=True):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                if task_id and data.get("task_id") != task_id:
                    continue

                record = StableRecord(
                    record_id=data.get("record_id", ""),
                    title=data.get("title", ""),
                    status=data.get("status", ""),
                    node=data.get("node", ""),
                    saved_at=data.get("saved_at", ""),
                    saved_by=data.get("saved_by", ""),
                    reason=data.get("reason", ""),
                    trigger_rule=data.get("trigger_rule", ""),
                    confidence_score=float(data.get("confidence_score", 0)),
                    remark=data.get("remark", ""),
                    task_id=data.get("task_id", ""),
                    task_code=data.get("task_code", ""),
                    git_commit=data.get("git_commit", ""),
                    git_branch=data.get("git_branch", ""),
                    extra_info=data.get("extra_info")
                )
                records.append(record)

                if len(records) >= limit:
                    break
            except Exception:
                continue

        return records

    def get_record(self, record_id: str) -> Optional[StableRecord]:
        """获取单个记录"""
        for r in self.list_records(limit=100):
            if r.record_id == record_id:
                return r
        return None

    def add_custom_rule(self, rule: Rule) -> None:
        """添加自定义规则"""
        self.rule_engine.rules[rule.rule_id] = rule


# 全局单例
_global_service: Optional[StableRecordService] = None


def get_stable_record_service() -> StableRecordService:
    """获取稳定记录点服务单例"""
    global _global_service
    if _global_service is None:
        _global_service = StableRecordService()
    return _global_service
