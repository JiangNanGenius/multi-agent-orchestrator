"""
记录点管理器单元测试
====================

使用方法:
  python -m pytest tests/test_checkpoint_manager.py -v
"""

import asyncio
import json
import tempfile
import os
from pathlib import Path
from datetime import datetime

import pytest

# 添加项目根目录到路径
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from agentorchestrator.checkpoint_manager import (
    CheckpointManager,
    CheckpointRuleEngine,
    Checkpoint,
    ExecutionContext,
    DecisionTrace,
    EnvironmentState,
    Artifacts,
    TriggerType,
)


@pytest.fixture
def temp_workspace():
    """创建临时工作区"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def manager(temp_workspace):
    """创建记录点管理器实例"""
    return CheckpointManager(str(temp_workspace))


@pytest.fixture
def sample_context():
    """创建示例执行上下文"""
    return ExecutionContext(
        current_step="测试步骤",
        step_history=[{"step": "步骤1", "result": "成功"}],
        context_variables={"key": "value", "test": True},
        tool_calls=[{"tool": "exec", "result": "ok"}],
        messages=[{"role": "user", "content": "测试消息"}],
    )


class TestCheckpointDataClass:
    """测试数据类"""

    def test_checkpoint_creation(self):
        """测试创建记录点"""
        cp = Checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL.value,
            trigger_reason="测试原因",
        )

        assert cp.checkpoint_id is not None
        assert len(cp.checkpoint_id) == 36  # UUID长度
        assert cp.task_id == "test-task"
        assert cp.agent_id == "test-agent"
        assert cp.trigger_type == "manual"
        assert cp.timestamp is not None

    def test_checkpoint_to_dict(self, sample_context):
        """测试转换为字典"""
        cp = Checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.CRITICAL_NODE.value,
            trigger_reason="里程碑达成",
            execution_context=sample_context,
        )

        data = cp.to_dict()

        assert data["checkpoint_id"] == cp.checkpoint_id
        assert data["task_id"] == "test-task"
        assert data["execution_context"]["current_step"] == "测试步骤"
        assert "metadata" in data
        assert data["metadata"]["version"] == "1.0"

    def test_checkpoint_from_dict(self, sample_context):
        """测试从字典恢复"""
        cp = Checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL.value,
            trigger_reason="测试",
            execution_context=sample_context,
        )

        data = cp.to_dict()
        cp2 = Checkpoint.from_dict(data)

        assert cp2.checkpoint_id == cp.checkpoint_id
        assert cp2.execution_context.current_step == sample_context.current_step

    def test_checkpoint_hash(self):
        """测试哈希计算"""
        cp = Checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL.value,
            trigger_reason="测试",
        )

        hash1 = cp.calculate_hash()
        hash2 = cp.calculate_hash()

        assert hash1 == hash2
        assert len(hash1) == 64  # SHA-256 长度

        # 修改内容后哈希应该变化
        cp.trigger_reason = "修改后的原因"
        hash3 = cp.calculate_hash()

        assert hash3 != hash1


class TestCheckpointRuleEngine:
    """测试规则引擎"""

    def test_engine_creation(self):
        """测试创建规则引擎"""
        engine = CheckpointRuleEngine()

        assert engine.threshold == 50
        assert engine.min_interval_seconds == 30

    def test_custom_config(self):
        """测试自定义配置"""
        config = {
            "threshold": 80,
            "min_interval_seconds": 60,
        }
        engine = CheckpointRuleEngine(config)

        assert engine.threshold == 80
        assert engine.min_interval_seconds == 60

    def test_task_success_trigger(self):
        """测试任务成功触发"""
        engine = CheckpointRuleEngine()

        context = {"task_completed": True}
        should_save, score, reasons = engine.should_save(context)

        assert should_save is True
        assert score >= 100
        assert "task_completion" in reasons

    def test_task_failure_trigger(self):
        """测试任务失败触发"""
        engine = CheckpointRuleEngine()

        context = {"error_occurred": True}
        should_save, score, reasons = engine.should_save(context)

        assert should_save is True
        assert "task_completion" in reasons

    def test_critical_node_trigger(self):
        """测试关键节点触发"""
        engine = CheckpointRuleEngine()

        context = {"is_critical_node": True}
        should_save, score, reasons = engine.should_save(context)

        assert should_save is True
        assert "critical_node" in reasons

    def test_user_instruction_trigger(self):
        """测试用户指令触发"""
        engine = CheckpointRuleEngine()

        context = {"user_requested_checkpoint": True}
        should_save, score, reasons = engine.should_save(context)

        assert should_save is True
        assert "user_instruction" in reasons

    def test_timer_trigger(self):
        """测试定时触发"""
        engine = CheckpointRuleEngine()

        context = {"elapsed_since_last_checkpoint": 400, "timer_interval": 300}
        should_save, score, reasons = engine.should_save(context)

        assert should_save is True
        assert "timer" in reasons

    def test_min_interval_protection(self):
        """测试最小间隔保护"""
        engine = CheckpointRuleEngine({"min_interval_seconds": 10})

        context = {"task_completed": True}

        # 第一次应该保存
        should_save1, _, _ = engine.should_save(context)
        assert should_save1 is True

        # 立即第二次不应该保存（间隔保护）
        should_save2, _, _ = engine.should_save(context)
        assert should_save2 is False

    def test_get_trigger_type(self):
        """测试获取触发类型"""
        engine = CheckpointRuleEngine()

        assert engine.get_trigger_type(["task_completion"]) == TriggerType.TASK_SUCCESS
        assert engine.get_trigger_type(["critical_node"]) == TriggerType.CRITICAL_NODE
        assert engine.get_trigger_type(["user_instruction"]) == TriggerType.USER_INSTRUCTION
        assert engine.get_trigger_type(["timer"]) == TriggerType.TIMER
        assert engine.get_trigger_type(["unknown"]) == TriggerType.MANUAL


class TestCheckpointManager:
    """测试记录点管理器"""

    def test_manager_creation(self, temp_workspace):
        """测试创建管理器"""
        manager = CheckpointManager(str(temp_workspace))

        assert manager.base_path == temp_workspace
        assert manager.checkpoints_dir.exists()
        assert manager.checkpoints_dir == temp_workspace / "context" / "snapshots"
        assert manager.audit_file.parent.exists()

    @pytest.mark.asyncio
    async def test_save_checkpoint(self, manager, sample_context):
        """测试保存记录点"""
        checkpoint = await manager.save_checkpoint(
            task_id="test-task-123",
            agent_id="test-agent",
            trigger_type=TriggerType.CRITICAL_NODE,
            trigger_reason="单元测试",
            execution_context=sample_context,
        )

        assert checkpoint is not None
        assert checkpoint.task_id == "test-task-123"
        assert checkpoint.trigger_type == "critical_node"

        # 验证文件已创建
        files = list(manager.checkpoints_dir.glob("checkpoint_*.json"))
        assert len(files) == 1

        # 验证索引已更新
        assert len(manager._index) == 1
        assert manager._index[0]["checkpoint_id"] == checkpoint.checkpoint_id

        # 验证审计日志已创建
        assert manager.audit_file.exists()

    @pytest.mark.asyncio
    async def test_list_checkpoints(self, manager, sample_context):
        """测试列出记录点"""
        # 保存多个记录点
        for i in range(3):
            await manager.save_checkpoint(
                task_id=f"task-{i}",
                agent_id="test-agent",
                trigger_type=TriggerType.MANUAL,
                trigger_reason=f"测试{i}",
                execution_context=sample_context,
            )

        # 列出所有
        all_cps = await manager.list_checkpoints()
        assert len(all_cps) == 3

        # 按任务过滤
        task0_cps = await manager.list_checkpoints(task_id="task-0")
        assert len(task0_cps) == 1
        assert task0_cps[0]["task_id"] == "task-0"

    @pytest.mark.asyncio
    async def test_load_checkpoint(self, manager, sample_context):
        """测试加载记录点"""
        # 先保存
        cp1 = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="加载测试",
            execution_context=sample_context,
        )

        # 再加载
        cp2 = await manager.load_checkpoint(cp1.checkpoint_id)

        assert cp2 is not None
        assert cp2.checkpoint_id == cp1.checkpoint_id
        assert cp2.execution_context.current_step == sample_context.current_step
        assert cp2.execution_context.context_variables["key"] == "value"

    @pytest.mark.asyncio
    async def test_load_nonexistent_checkpoint(self, manager):
        """测试加载不存在的记录点"""
        cp = await manager.load_checkpoint("non-existent-id")
        assert cp is None

    @pytest.mark.asyncio
    async def test_restore_checkpoint(self, manager, sample_context):
        """测试恢复执行上下文"""
        cp = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="恢复测试",
            execution_context=sample_context,
        )

        restored = await manager.restore_checkpoint(cp.checkpoint_id)

        assert restored is not None
        assert restored.current_step == sample_context.current_step
        assert restored.context_variables == sample_context.context_variables

    @pytest.mark.asyncio
    async def test_delete_checkpoint(self, manager, sample_context):
        """测试删除记录点"""
        cp = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="删除测试",
            execution_context=sample_context,
        )

        # 删除
        result = await manager.delete_checkpoint(cp.checkpoint_id)
        assert result is True

        # 验证已删除
        cps = await manager.list_checkpoints()
        assert len(cps) == 0

        # 再次删除应该返回False
        result2 = await manager.delete_checkpoint(cp.checkpoint_id)
        assert result2 is False

    @pytest.mark.asyncio
    async def test_diff_checkpoints(self, manager, sample_context):
        """测试对比记录点"""
        cp1 = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="对比测试1",
            execution_context=sample_context,
        )

        # 保存第二个
        sample_context.step_history.append({"step": "步骤2", "result": "成功"})
        cp2 = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="对比测试2",
            execution_context=sample_context,
        )

        # 对比
        diff = await manager.diff_checkpoints(cp1.checkpoint_id, cp2.checkpoint_id)

        assert "error" not in diff
        assert diff["checkpoint1"]["id"] == cp1.checkpoint_id
        assert diff["checkpoint2"]["id"] == cp2.checkpoint_id
        assert diff["time_diff_seconds"] >= 0

    @pytest.mark.asyncio
    async def test_should_autosave(self, manager):
        """测试自动保存判断"""
        context = {
            "task_completed": True,
            "is_critical_node": False,
        }

        should_save, trigger_type, reason = manager.should_autosave(context)

        assert should_save is True
        assert trigger_type == TriggerType.TASK_SUCCESS
        assert "自动触发" in reason

    @pytest.mark.asyncio
    async def test_tamper_detection(self, manager, sample_context):
        """测试防篡改检测"""
        cp = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="篡改测试",
            execution_context=sample_context,
        )

        # 手动修改文件内容模拟篡改
        filepath = manager.checkpoints_dir / manager._index[0]["filename"]
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        data["trigger_reason"] = "被篡改的内容"

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f)

        # 加载时应该检测到篡改
        with pytest.raises(ValueError, match="可能被篡改"):
            await manager.load_checkpoint(cp.checkpoint_id)

    @pytest.mark.asyncio
    async def test_compressed_save(self, manager, sample_context):
        """测试压缩存储"""
        cp = await manager.save_checkpoint(
            task_id="test-task",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="压缩测试",
            execution_context=sample_context,
            compress=True,
        )

        # 验证文件是.gz后缀
        assert manager._index[0]["compressed"] is True
        assert manager._index[0]["filename"].endswith(".gz")

        # 应该能够正常加载
        cp2 = await manager.load_checkpoint(cp.checkpoint_id)
        assert cp2 is not None


class TestManagerIntegration:
    """集成测试"""

    @pytest.mark.asyncio
    async def test_full_workflow(self, temp_workspace, sample_context):
        """测试完整工作流：保存 -> 列出 -> 加载 -> 删除"""
        manager = CheckpointManager(str(temp_workspace))

        # 1. 保存
        cp = await manager.save_checkpoint(
            task_id="integration-test",
            agent_id="test-agent",
            trigger_type=TriggerType.CRITICAL_NODE,
            trigger_reason="集成测试",
            execution_context=sample_context,
        )
        assert cp is not None

        # 2. 列出
        cps = await manager.list_checkpoints()
        assert len(cps) == 1

        # 3. 加载
        loaded = await manager.load_checkpoint(cp.checkpoint_id)
        assert loaded is not None
        assert loaded.trigger_reason == "集成测试"

        # 4. 恢复
        restored = await manager.restore_checkpoint(cp.checkpoint_id)
        assert restored is not None
        assert restored.current_step == sample_context.current_step

        # 5. 删除
        result = await manager.delete_checkpoint(cp.checkpoint_id)
        assert result is True

        # 验证已删除
        cps_after = await manager.list_checkpoints()
        assert len(cps_after) == 0

    @pytest.mark.asyncio
    async def test_audit_log(self, manager, sample_context):
        """测试审计日志"""
        # 执行一系列操作
        cp = await manager.save_checkpoint(
            task_id="audit-test",
            agent_id="test-agent",
            trigger_type=TriggerType.MANUAL,
            trigger_reason="审计测试",
            execution_context=sample_context,
        )

        await manager.load_checkpoint(cp.checkpoint_id)
        await manager.restore_checkpoint(cp.checkpoint_id)
        await manager.delete_checkpoint(cp.checkpoint_id)

        # 验证审计日志包含所有操作
        with open(manager.audit_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        actions = [json.loads(line)["action"] for line in lines]

        assert "save" in actions
        assert "load" in actions
        assert "restore" in actions
        assert "delete" in actions
        assert len(actions) == 4


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
