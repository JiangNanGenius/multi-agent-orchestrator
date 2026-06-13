"""
稳定记录点服务单元测试
========================

运行方式:
  python -m pytest tests/test_stable_record_service.py -v
"""

import json
import tempfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import pytest

# 添加路径
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "agentorchestrator" / "backend"))

from app.services.stable_record_service import (
    StableRecordService,
    RecordStatus,
    RuleType,
    Rule,
    RulePriority
)


@pytest.fixture
def temp_records_dir():
    """创建临时记录目录"""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def service(temp_records_dir):
    """创建服务实例"""
    return StableRecordService(records_dir=temp_records_dir)


class TestStableRecordService:
    """稳定记录点服务测试"""

    def test_init_default_rules(self, service):
        """测试初始化默认规则"""
        assert len(service.rules) >= 5
        rule_ids = [r.rule_id for r in service.rules]
        assert "task_done" in rule_ids
        assert "time_interval_4h" in rule_ids
        assert "ci_success" in rule_ids

    def test_create_record(self, service):
        """测试创建记录点"""
        record = service.create_record(
            title="测试记录点",
            status=RecordStatus.STABLE,
            node="test_node",
            reason="测试原因",
            trigger_rule="test_rule",
            confidence_score=85.5,
            task_id="test_task_001"
        )

        assert record.record_id.startswith("STABLE_")
        assert record.title == "测试记录点"
        assert record.status == RecordStatus.STABLE
        assert record.node == "test_node"
        assert record.confidence_score == 85.5
        assert record.task_id == "test_task_001"

        # 验证文件已创建
        record_files = list(Path(service.records_dir).glob("*.json"))
        assert len(record_files) == 1

    def test_create_record_with_extra_info(self, service):
        """测试创建带额外信息的记录点"""
        extra = {"key1": "value1", "key2": 123}
        record = service.create_record(
            title="带额外信息的记录",
            extra_info=extra
        )

        assert record.extra_info == extra

    def test_list_records(self, service):
        """测试列出记录点"""
        # 创建多个记录
        for i in range(5):
            service.create_record(title=f"记录{i}", task_id=f"task_{i % 2}")

        # 测试列出全部
        all_records = service.list_records(limit=10)
        assert len(all_records) == 5

        # 测试按task_id过滤
        task0_records = service.list_records(limit=10, task_id="task_0")
        assert len(task0_records) == 3  # 0, 2, 4

        # 测试limit
        limited = service.list_records(limit=2)
        assert len(limited) == 2

    def test_get_record(self, service):
        """测试获取单个记录"""
        record = service.create_record(title="测试获取")
        retrieved = service.get_record(record.record_id)

        assert retrieved is not None
        assert retrieved.record_id == record.record_id
        assert retrieved.title == "测试获取"

    def test_get_record_not_found(self, service):
        """测试获取不存在的记录"""
        retrieved = service.get_record("non_existent_id")
        assert retrieved is None


class TestRuleEvaluation:
    """规则评估测试"""

    def test_task_completion_rule_done_state(self, service):
        """测试任务完成规则 - Done状态"""
        context = {
            "task_state": "Done",
            "task_progress": 100
        }

        should_create, confidence, rules = service.should_create_record(context)
        assert should_create == True
        assert "task_done" in rules
        assert confidence >= 60

    def test_task_completion_rule_milestone(self, service):
        """测试任务完成规则 - 里程碑关键词"""
        context = {
            "task_title": "核心功能开发完成，已达里程碑",
            "task_progress": 80
        }

        rule_scores = service.evaluate_all_rules(context)
        milestone_matches = [
            (r, s) for r, s in rule_scores
            if r.rule_type == RuleType.TASK_COMPLETION and s > 0
        ]
        assert len(milestone_matches) > 0

    def test_time_interval_rule_first_run(self, service):
        """测试时间间隔规则 - 首次运行"""
        context = {}

        rule_scores = service.evaluate_all_rules(context)
        time_rules = [
            (r, s) for r, s in rule_scores
            if r.rule_type == RuleType.TIME_INTERVAL
        ]
        # 首次运行应该有基础分
        assert len(time_rules) > 0

    def test_quality_threshold_rule_ci_passed(self, service):
        """测试质量阈值规则 - CI通过"""
        context = {
            "ci_passed": True,
            "test_coverage": 85
        }

        rule_scores = service.evaluate_all_rules(context)
        quality_rules = [
            (r, s) for r, s in rule_scores
            if r.rule_type == RuleType.QUALITY_THRESHOLD and s > 0
        ]
        assert len(quality_rules) > 0
        assert quality_rules[0][1] >= 70

    def test_risk_event_rule_hotfix(self, service):
        """测试风险事件规则 - 热修复"""
        context = {
            "event_type": "hotfix",
            "message": "紧急Bug修复已应用"
        }

        rule_scores = service.evaluate_all_rules(context)
        risk_rules = [
            (r, s) for r, s in rule_scores
            if r.rule_type == RuleType.RISK_EVENT and s > 0
        ]
        assert len(risk_rules) > 0

    def test_manual_request_rule(self, service):
        """测试人工请求规则"""
        context = {
            "manual_request": True
        }

        should_create, confidence, rules = service.should_create_record(context)
        assert should_create == True
        assert confidence >= 90

    def test_high_priority_rule_triggers(self, service):
        """测试高优先级规则触发直接创建"""
        context = {
            "task_state": "Done",  # 高优先级
            "task_progress": 100
        }

        should_create, _, _ = service.should_create_record(context)
        assert should_create == True


class TestDebounceMechanism:
    """防抖机制测试"""

    def test_debounce_prevents_quick_creation(self, service):
        """测试短时间内重复创建被阻止"""
        task_id = "test_debounce_task"
        context = {
            "task_id": task_id,
            "task_state": "Done",
            "task_progress": 100
        }

        # 第一次应该创建
        created1, record1 = service.auto_create_if_needed(task_id, context)
        assert created1 == True

        # 立即第二次应该被阻止
        created2, record2 = service.auto_create_if_needed(task_id, context)
        assert created2 == False

    def test_debounce_expires_after_time(self, service):
        """测试防抖时间过期后可以再次创建"""
        task_id = "test_debounce_expire"
        context = {
            "task_id": task_id,
            "task_state": "Done",
            "task_progress": 100
        }

        # 第一次创建
        created1, _ = service.auto_create_if_needed(task_id, context)
        assert created1 == True

        # 手动清除防抖记录（模拟时间过去）
        service.last_record_time.clear()

        # 第二次应该可以创建
        created2, _ = service.auto_create_if_needed(task_id, context)
        assert created2 == True


class TestAutoCreate:
    """自动创建测试"""

    def test_auto_create_creates_when_needed(self, service):
        """测试满足条件时自动创建"""
        context = {
            "task_state": "Done",
            "task_progress": 100,
            "task_title": "测试任务"
        }

        created, record = service.auto_create_if_needed("task_001", context)
        assert created == True
        assert record is not None
        assert record.task_id == "task_001"

    def test_auto_create_skips_when_not_needed(self, service):
        """测试不满足条件时不创建"""
        context = {
            "task_state": "Doing",
            "task_progress": 30,
            "ci_passed": False,
            "test_coverage": 30
        }

        created, record = service.auto_create_if_needed("task_low_confidence", context)
        assert created == False
        assert record is None

    def test_auto_create_with_default_title(self, service):
        """测试使用自定义标题"""
        custom_title = "自定义记录点标题"
        context = {
            "task_state": "Done",
            "task_progress": 100
        }

        created, record = service.auto_create_if_needed(
            "task_custom_title", context, default_title=custom_title
        )
        assert created == True
        assert record.title == custom_title

    def test_auto_create_generates_title_from_task(self, service):
        """测试从任务标题生成记录点标题"""
        context = {
            "task_state": "Done",
            "task_progress": 100,
            "task_title": "我的重要任务"
        }

        created, record = service.auto_create_if_needed("task_gen_title", context)
        assert created == True
        assert "我的重要任务" in record.title


class TestCustomRules:
    """自定义规则测试"""

    def test_add_custom_rule(self, service):
        """测试添加自定义规则"""
        initial_count = len(service.rules)

        custom_rule = Rule(
            rule_id="custom_test_rule",
            rule_type=RuleType.TASK_COMPLETION,
            name="自定义测试规则",
            description="测试自定义规则",
            priority=RulePriority.HIGH,
            threshold=50.0,
            config={"custom_key": "custom_value"}
        )

        service.add_custom_rule(custom_rule)

        assert len(service.rules) == initial_count + 1
        rule_ids = [r.rule_id for r in service.rules]
        assert "custom_test_rule" in rule_ids

    def test_custom_rule_replaces_existing(self, service):
        """测试添加同ID规则会替换原有规则"""
        # 添加第一个版本
        rule_v1 = Rule(
            rule_id="versioned_rule",
            rule_type=RuleType.TASK_COMPLETION,
            name="版本1",
            priority=RulePriority.LOW,
            threshold=80.0
        )
        service.add_custom_rule(rule_v1)

        # 添加第二个版本
        rule_v2 = Rule(
            rule_id="versioned_rule",
            rule_type=RuleType.TASK_COMPLETION,
            name="版本2",
            priority=RulePriority.HIGH,
            threshold=50.0
        )
        service.add_custom_rule(rule_v2)

        # 验证是替换而不是新增
        versioned_rules = [r for r in service.rules if r.rule_id == "versioned_rule"]
        assert len(versioned_rules) == 1
        assert versioned_rules[0].name == "版本2"
        assert versioned_rules[0].priority == RulePriority.HIGH


class TestRecordData:
    """记录数据测试"""

    def test_record_to_dict(self, service):
        """测试记录点转字典"""
        record = service.create_record(
            title="字典测试",
            status=RecordStatus.MILESTONE,
            confidence_score=92.5
        )

        record_dict = record.to_dict()
        assert isinstance(record_dict, dict)
        assert record_dict["title"] == "字典测试"
        assert record_dict["status"] == RecordStatus.MILESTONE
        assert record_dict["confidence_score"] == 92.5

    def test_record_to_json(self, service):
        """测试记录点转JSON"""
        record = service.create_record(title="JSON测试")

        json_str = record.to_json()
        parsed = json.loads(json_str)

        assert parsed["title"] == "JSON测试"
        assert parsed["record_id"] == record.record_id


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
