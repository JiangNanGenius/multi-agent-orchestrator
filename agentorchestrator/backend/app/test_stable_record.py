"""
稳定记录点服务单元测试
"""

import pytest
import asyncio
import os
import tempfile
import shutil
from datetime import datetime

from .services.stable_record_service import (
    RuleEngine,
    TriggerEvaluator,
    RecordPointManager,
    WorkspaceSnapshot,
    Rule,
    RuleType,
    TriggerSignal,
    TriggerSource,
)


class TestRuleEngine:
    """规则引擎测试"""

    def test_default_rules_loaded(self):
        """测试默认规则已加载"""
        engine = RuleEngine()
        rules = engine.get_enabled_rules()
        assert len(rules) > 0
        rule_ids = [r.rule_id for r in rules]
        assert "task_done" in rule_ids
        assert "time_interval_1h" in rule_ids
        assert "ci_success" in rule_ids

    def test_add_rule(self):
        """测试添加规则"""
        engine = RuleEngine()
        initial_count = len(engine.get_enabled_rules())

        new_rule = Rule(
            rule_id="test_rule",
            rule_type=RuleType.TASK_COMPLETION,
            name="测试规则",
            description="测试描述",
            weight=2.0,
            condition={"test": "value"},
        )
        engine.add_rule(new_rule)

        assert len(engine.get_enabled_rules()) == initial_count + 1
        assert engine.rules["test_rule"].name == "测试规则"

    def test_remove_rule(self):
        """测试删除规则"""
        engine = RuleEngine()
        initial_count = len(engine.get_enabled_rules())

        engine.remove_rule("task_done")
        assert len(engine.get_enabled_rules()) == initial_count - 1
        assert "task_done" not in engine.rules


class TestTriggerEvaluator:
    """触发评估器测试"""

    def test_user_request_rule(self):
        """测试用户请求规则"""
        engine = RuleEngine()
        evaluator = TriggerEvaluator(engine)

        signal = TriggerSignal(source=TriggerSource.USER_SIGNAL)
        context = {"user_requested": True, "decision_threshold": 1.0}

        decision = evaluator.evaluate_signal(signal, context)
        assert decision.should_create is True
        assert "user_request" in decision.triggered_rules

    def test_task_done_rule(self):
        """测试任务完成规则"""
        engine = RuleEngine()
        evaluator = TriggerEvaluator(engine)

        signal = TriggerSignal(source=TriggerSource.TASK_STATE_CHANGE)
        context = {"task_state": "Done", "decision_threshold": 1.0}

        decision = evaluator.evaluate_signal(signal, context)
        assert decision.should_create is True
        assert "task_done" in decision.triggered_rules

    def test_ci_success_rule(self):
        """测试CI成功规则"""
        engine = RuleEngine()
        evaluator = TriggerEvaluator(engine)

        signal = TriggerSignal(source=TriggerSource.CI_RESULT)
        context = {"ci_status": "success", "decision_threshold": 1.0}

        decision = evaluator.evaluate_signal(signal, context)
        assert decision.should_create is True
        assert "ci_success" in decision.triggered_rules

    def test_threshold_not_met(self):
        """测试阈值未满足"""
        engine = RuleEngine()
        evaluator = TriggerEvaluator(engine)

        signal = TriggerSignal(source=TriggerSource.PROGRESS_UPDATE)
        context = {"completion_rate": 0.5, "decision_threshold": 10.0}  # 高阈值

        decision = evaluator.evaluate_signal(signal, context)
        assert decision.should_create is False

    def test_cooldown(self):
        """测试冷却机制"""
        engine = RuleEngine()
        evaluator = TriggerEvaluator(engine)

        # 第一次评估
        signal = TriggerSignal(source=TriggerSource.USER_SIGNAL)
        context = {"user_requested": True, "decision_threshold": 1.0}
        evaluator.evaluate_signal(signal, context)

        # 立即第二次评估（冷却期内）
        decision = evaluator.evaluate_signal(signal, context)
        assert decision.should_create is False
        assert "冷却期" in decision.reason


class TestWorkspaceSnapshot:
    """工作区快照测试"""

    def setup_method(self):
        """创建临时工作区"""
        self.temp_dir = tempfile.mkdtemp()
        # 创建必要的目录结构
        os.makedirs(os.path.join(self.temp_dir, "context", "snapshots"), exist_ok=True)
        # 创建一些测试文件
        with open(os.path.join(self.temp_dir, "README.md"), "w") as f:
            f.write("# Test Project")
        with open(os.path.join(self.temp_dir, "PLAN.md"), "w") as f:
            f.write("# Test Plan")

    def teardown_method(self):
        """清理临时目录"""
        shutil.rmtree(self.temp_dir)

    def test_create_snapshot(self):
        """测试创建快照"""
        snapshot = WorkspaceSnapshot(self.temp_dir)
        record_id = "TEST_001"
        context = {"task_id": "123", "progress": 50}

        snapshot_path = snapshot.create_snapshot(record_id, context)

        assert os.path.exists(snapshot_path)
        assert "TEST_001" in snapshot_path

        # 验证快照内容
        with open(snapshot_path, "r") as f:
            import json
            data = json.load(f)

        assert data["record_id"] == record_id
        assert "files" in data
        assert "README.md" in data["files"]
        assert data["files"]["README.md"]["exists"] is True
        assert "git_info" in data


class TestRecordPointManager:
    """记录点管理器测试"""

    def setup_method(self):
        """创建临时工作区"""
        self.temp_dir = tempfile.mkdtemp()
        # 创建必要的目录结构
        os.makedirs(os.path.join(self.temp_dir, "context", "snapshots"), exist_ok=True)
        os.makedirs(os.path.join(self.temp_dir, "artifacts", "stable_records"), exist_ok=True)

    def teardown_method(self):
        """清理临时目录"""
        shutil.rmtree(self.temp_dir)

    def test_create_record_manually(self):
        """测试手动创建记录点"""
        manager = RecordPointManager(self.temp_dir)

        signal = TriggerSignal(source=TriggerSource.USER_SIGNAL)
        context = {"user_requested": True, "decision_threshold": 1.0}

        result = asyncio.run(manager.evaluate_and_create(signal, context))

        assert result is not None
        assert result["record_id"].startswith("STABLE_")
        assert result["created_by"] == "auto_decision_engine"
        assert "stable_records" in result["record_id"] or "stable_records" in str(os.listdir(os.path.join(self.temp_dir, "artifacts", "stable_records")))

    def test_list_records_empty(self):
        """测试空记录列表"""
        manager = RecordPointManager(self.temp_dir)
        records = manager.list_records()
        assert isinstance(records, list)
        assert len(records) == 0

    def test_list_records_after_create(self):
        """测试创建后列出记录"""
        manager = RecordPointManager(self.temp_dir)

        # 创建记录
        signal = TriggerSignal(source=TriggerSource.USER_SIGNAL)
        context = {"user_requested": True, "decision_threshold": 1.0}
        asyncio.run(manager.evaluate_and_create(signal, context))

        # 列出记录
        records = manager.list_records()
        assert len(records) >= 1
        assert records[0]["record_id"].startswith("STABLE_")


class TestIntegration:
    """集成测试"""

    def setup_method(self):
        """创建临时工作区"""
        self.temp_dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.temp_dir, "context", "snapshots"), exist_ok=True)
        os.makedirs(os.path.join(self.temp_dir, "artifacts", "stable_records"), exist_ok=True)

    def teardown_method(self):
        """清理临时目录"""
        shutil.rmtree(self.temp_dir)

    def test_full_workflow(self):
        """测试完整工作流"""
        manager = RecordPointManager(self.temp_dir)

        # 1. 任务完成信号
        signal = TriggerSignal(
            source=TriggerSource.TASK_STATE_CHANGE,
            task_id="TASK_001",
            workspace=self.temp_dir,
        )
        context = {
            "task_id": "TASK_001",
            "task_code": "TEST-001",
            "task_state": "Done",
            "task_title": "测试任务完成",
            "completion_rate": 1.0,
            "ci_status": "success",
            "test_coverage": 90,
            "has_activity": True,
            "decision_threshold": 1.0,
        }

        result = asyncio.run(manager.evaluate_and_create(signal, context))

        # 应该创建记录
        assert result is not None
        assert "task_done" in result["triggered_rules"] or "ci_success" in result["triggered_rules"]

        # 验证记录存在
        records = manager.list_records()
        assert len(records) == 1
        assert records[0]["record_id"] == result["record_id"]

    def test_milestone_trigger(self):
        """测试里程碑触发"""
        manager = RecordPointManager(self.temp_dir)

        signal = TriggerSignal(source=TriggerSource.PROGRESS_UPDATE)
        context = {
            "completion_rate": 0.9,  # 90% 完成
            "decision_threshold": 1.0,
        }

        result = asyncio.run(manager.evaluate_and_create(signal, context))

        # milestone_reached 规则应该触发
        assert result is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
