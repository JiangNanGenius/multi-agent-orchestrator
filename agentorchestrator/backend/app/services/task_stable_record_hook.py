"""
任务系统与稳定记录点集成钩子
============================

在任务状态变化、进度更新等关键节点，自动检查是否需要创建稳定记录点。

使用方式：
    from app.services.task_stable_record_hook import TaskStableRecordHook

    # 在任务服务中注册钩子
    hook = TaskStableRecordHook()
    hook.on_task_state_changed(task, old_state, new_state)
    hook.on_task_progress_updated(task, progress_content)
"""

from __future__ import annotations

import logging
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class TaskStableRecordHook:
    """任务系统稳定记录点集成钩子"""

    def __init__(self):
        self._service = None
        self._event_bus = None

    def _get_service(self):
        """懒加载服务"""
        if self._service is None:
            try:
                from app.services.stable_record_service import StableRecordService
                self._service = StableRecordService()
            except ImportError as e:
                logger.warning(f"StableRecordService 导入失败: {e}")
                return None
        return self._service

    def _get_event_bus(self):
        """懒加载事件总线"""
        if self._event_bus is None:
            try:
                from app.services.event_bus import get_event_bus
                self._event_bus = get_event_bus()
            except ImportError as e:
                logger.warning(f"EventBus 导入失败: {e}")
                return None
        return self._event_bus

    def _build_context(self, task, **kwargs) -> dict:
        """构建上下文信息"""
        context = {
            "task_id": str(task.id) if hasattr(task, 'id') else str(getattr(task, 'task_id', '')),
            "task_code": getattr(task, 'task_code', ''),
            "task_title": getattr(task, 'title', ''),
            "task_state": getattr(task, 'state', ''),
            "task_progress": kwargs.get('progress', 0),
            "node": "task_service",
        }
        context.update(kwargs)
        return context

    def on_task_state_changed(self, task, old_state: str, new_state: str) -> bool:
        """任务状态变化时调用

        Args:
            task: 任务对象
            old_state: 旧状态
            new_state: 新状态

        Returns:
            是否创建了记录点
        """
        service = self._get_service()
        if not service:
            return False

        try:
            context = self._build_context(
                task,
                task_state=new_state,
                old_state=old_state,
                event_type=f"state_change_{old_state}_to_{new_state}"
            )

            # 特别标记Done状态
            if new_state == "Done":
                context["task_progress"] = 100
                context["message"] = "任务已完成"

            created, record = service.auto_create_if_needed(
                task_id=context["task_id"],
                context=context
            )

            if created and record:
                logger.info(f"任务状态变化触发稳定记录点: {record.record_id}, {old_state} -> {new_state}")

                # 保存到任务工作区
                self._save_to_workspace(task, record)

                # 发布事件
                self._publish_event("stable_record.created", {
                    "record_id": record.record_id,
                    "task_id": context["task_id"],
                    "task_code": context["task_code"],
                    "trigger": "state_change",
                    "old_state": old_state,
                    "new_state": new_state
                })

                return True

            return False

        except Exception as e:
            logger.error(f"任务状态变化钩子执行失败: {e}", exc_info=True)
            return False

    def on_task_progress_updated(self, task, progress_content: str) -> bool:
        """任务进度更新时调用

        Args:
            task: 任务对象
            progress_content: 进度内容

        Returns:
            是否创建了记录点
        """
        service = self._get_service()
        if not service:
            return False

        try:
            # 从进度内容中提取关键词，判断是否是里程碑
            milestone_keywords = ["完成", "里程碑", "交付", "上线", "重构完成", "开发完成", "测试完成"]
            is_milestone = any(kw in progress_content for kw in milestone_keywords)

            context = self._build_context(
                task,
                message=progress_content,
                event_type="progress_update" if not is_milestone else "milestone",
                is_milestone=is_milestone
            )

            created, record = service.auto_create_if_needed(
                task_id=context["task_id"],
                context=context
            )

            if created and record:
                logger.info(f"任务进度更新触发稳定记录点: {record.record_id}")

                # 保存到任务工作区
                self._save_to_workspace(task, record)

                # 发布事件
                self._publish_event("stable_record.created", {
                    "record_id": record.record_id,
                    "task_id": context["task_id"],
                    "task_code": context["task_code"],
                    "trigger": "progress_update",
                    "is_milestone": is_milestone
                })

                return True

            return False

        except Exception as e:
            logger.error(f"任务进度更新钩子执行失败: {e}", exc_info=True)
            return False

    def on_task_review_completed(self, task, review_result: str) -> bool:
        """任务评审完成时调用

        Args:
            task: 任务对象
            review_result: 评审结果: pass/rework/reject

        Returns:
            是否创建了记录点
        """
        service = self._get_service()
        if not service:
            return False

        try:
            context = self._build_context(
                task,
                event_type="review_completed",
                review_result=review_result,
                message=f"评审完成: {review_result}"
            )

            # 评审通过时提高置信度
            if review_result == "pass":
                context["manual_request"] = True

            created, record = service.auto_create_if_needed(
                task_id=context["task_id"],
                context=context
            )

            if created and record:
                logger.info(f"任务评审完成触发稳定记录点: {record.record_id}, 结果: {review_result}")

                self._save_to_workspace(task, record)

                self._publish_event("stable_record.created", {
                    "record_id": record.record_id,
                    "task_id": context["task_id"],
                    "task_code": context["task_code"],
                    "trigger": "review_completed",
                    "review_result": review_result
                })

                return True

            return False

        except Exception as e:
            logger.error(f"任务评审完成钩子执行失败: {e}", exc_info=True)
            return False

    def _save_to_workspace(self, task, record) -> None:
        """将记录点保存到任务工作区"""
        try:
            # 获取工作区路径
            workspace_path = getattr(task, 'workspace_path', None)
            if not workspace_path:
                # 尝试从meta中获取
                meta = getattr(task, 'meta', {}) or {}
                workspace_path = meta.get('workspace', {}).get('path') if isinstance(meta, dict) else None

            if not workspace_path:
                logger.debug(f"任务工作区路径不存在，跳过保存")
                return

            workspace = Path(workspace_path)
            if not workspace.exists():
                logger.debug(f"任务工作区不存在: {workspace_path}")
                return

            # 保存到 artifacts/stable_records/ 目录
            records_dir = workspace / "artifacts" / "stable_records"
            records_dir.mkdir(parents=True, exist_ok=True)

            filename = f"{record.record_id}.json"
            filepath = records_dir / filename

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(record.to_json())

            logger.debug(f"稳定记录点已保存到工作区: {filepath}")

            # 更新工作区的 latest_handoff 信息（如果有）
            self._update_workspace_meta(workspace, record)

        except Exception as e:
            logger.warning(f"保存记录点到工作区失败: {e}")

    def _update_workspace_meta(self, workspace: Path, record) -> None:
        """更新工作区元数据"""
        try:
            # 更新 HANDOFF.md 添加记录点信息
            handoff_path = workspace / "HANDOFF.md"
            if handoff_path.exists():
                content = handoff_path.read_text(encoding='utf-8')

                # 检查是否已经有稳定记录点部分
                if "## 稳定记录点" not in content:
                    content += "\n\n## 稳定记录点\n\n"

                # 添加最新记录点信息
                record_entry = (
                    f"- [{record.record_id}] {record.title}\n"
                    f"  - 状态: {record.status}\n"
                    f"  - 时间: {record.saved_at}\n"
                    f"  - 置信度: {record.confidence_score}%\n"
                    f"  - 原因: {record.reason}\n\n"
                )

                content += record_entry
                handoff_path.write_text(content, encoding='utf-8')

        except Exception as e:
            logger.debug(f"更新工作区元数据失败: {e}")

    def _publish_event(self, event_type: str, data: dict) -> None:
        """发布事件到事件总线"""
        try:
            event_bus = self._get_event_bus()
            if event_bus:
                # 异步发布事件
                import asyncio
                asyncio.create_task(event_bus.publish(event_type, data))
        except Exception as e:
            logger.debug(f"发布事件失败: {e}")


# 全局单例
_global_hook: Optional[TaskStableRecordHook] = None


def get_task_stable_record_hook() -> TaskStableRecordHook:
    """获取任务稳定记录点钩子单例"""
    global _global_hook
    if _global_hook is None:
        _global_hook = TaskStableRecordHook()
    return _global_hook
