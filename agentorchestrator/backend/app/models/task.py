from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, Column, DateTime, Enum, Index, JSON, String, Text, Uuid

from ..db import Base


class TaskState(str, enum.Enum):
    """任务状态枚举 —— 映射 AGENTORCHESTRATOR 当前中心/专家协作流程。"""

    ControlCenter = "ControlCenter"
    PlanCenter = "PlanCenter"
    ReviewCenter = "ReviewCenter"
    Assigned = "Assigned"
    Next = "Next"
    Doing = "Doing"
    Review = "Review"
    Done = "Done"
    Blocked = "Blocked"
    Cancelled = "Cancelled"
    Pending = "Pending"
    PendingConfirm = "PendingConfirm"


TERMINAL_STATES = {TaskState.Done, TaskState.Cancelled}

STATE_TRANSITIONS = {
    TaskState.Pending: {TaskState.ControlCenter, TaskState.Cancelled},
    TaskState.ControlCenter: {TaskState.PlanCenter, TaskState.Cancelled},
    TaskState.PlanCenter: {TaskState.ReviewCenter, TaskState.ControlCenter, TaskState.Cancelled, TaskState.Blocked},
    TaskState.ReviewCenter: {TaskState.Assigned, TaskState.PlanCenter, TaskState.Cancelled},
    TaskState.Assigned: {TaskState.Doing, TaskState.Next, TaskState.ReviewCenter, TaskState.Cancelled, TaskState.Blocked},
    TaskState.Next: {TaskState.Doing, TaskState.Assigned, TaskState.Cancelled, TaskState.Blocked},
    TaskState.Doing: {TaskState.Assigned, TaskState.Review, TaskState.Done, TaskState.Blocked, TaskState.Cancelled},
    TaskState.Review: {TaskState.Done, TaskState.ReviewCenter, TaskState.Doing, TaskState.Cancelled, TaskState.PendingConfirm},
    TaskState.PendingConfirm: {TaskState.Done, TaskState.Review, TaskState.Cancelled},
    TaskState.Blocked: {
        TaskState.ControlCenter,
        TaskState.PlanCenter,
        TaskState.ReviewCenter,
        TaskState.Assigned,
        TaskState.Next,
        TaskState.Doing,
        TaskState.Review,
        TaskState.Cancelled,
    },
}

STATE_AGENT_MAP = {
    TaskState.ControlCenter: "control_center",
    TaskState.PlanCenter: "plan_center",
    TaskState.ReviewCenter: "review_center",
    TaskState.Assigned: "dispatch_center",
    TaskState.Review: "dispatch_center",
    TaskState.PendingConfirm: "dispatch_center",
    TaskState.Pending: "plan_center",
}

ORG_AGENT_MAP = {
    "总控中心": "control_center",
    "规划中心": "plan_center",
    "评审中心": "review_center",
    "调度中心": "dispatch_center",
    "数据专家": "data_specialist",
    "文案专家": "docs_specialist",
    "代码专家": "code_specialist",
    "审计专家": "audit_specialist",
    "部署专家": "deploy_specialist",
    "管理专家": "admin_specialist",
    "技能管理员": "admin_specialist",
    "搜索专家": "search_specialist",
}

STATE_ORG_MAP = {
    TaskState.ControlCenter: "总控中心",
    TaskState.PlanCenter: "规划中心",
    TaskState.ReviewCenter: "评审中心",
    TaskState.Assigned: "调度中心",
    TaskState.Review: "调度中心",
    TaskState.PendingConfirm: "调度中心",
    TaskState.Pending: "规划中心",
}


class Task(Base):
    """AGENTORCHESTRATOR 中心/专家协作任务表。"""

    __tablename__ = "tasks"

    task_id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trace_id = Column(String(64), nullable=False, default=lambda: str(uuid.uuid4()), comment="追踪链路 ID")
    title = Column(String(200), nullable=False, comment="任务标题")
    description = Column(Text, default="", comment="任务描述")
    priority = Column(String(10), default="中", comment="优先级")
    state = Column(
        Enum(TaskState, name="task_state", native_enum=False, validate_strings=True),
        nullable=False,
        default=TaskState.ControlCenter,
        comment="任务状态",
    )
    assignee_org = Column(String(50), nullable=True, comment="目标执行中心 / 专家")
    creator = Column(String(50), default="system", comment="创建者")
    tags = Column(JSON, default=list, comment="标签")
    meta = Column(JSON, default=dict, comment="扩展元数据")

    # 看板与前端通用字段
    org = Column(String(32), nullable=False, default="总控中心", comment="当前执行组织")
    owner = Column("official", String(32), default="", comment="责任角色 / 任务负责人")
    now = Column(Text, default="", comment="当前进展描述")
    eta = Column(String(64), default="-", comment="预计完成时间")
    block = Column(Text, default="无", comment="阻塞原因")
    output = Column(Text, default="", comment="最终产出")
    archived = Column(Boolean, default=False, comment="是否归档")

    flow_log = Column(JSON, default=list, comment="流转日志 [{at, from, to, remark}]")
    progress_log = Column(JSON, default=list, comment="进展日志 [{at, agent, text, todos}]")
    todos = Column(JSON, default=list, comment="子任务 [{id, title, status, detail}]")
    scheduler = Column(JSON, default=dict, comment="调度器元数据")
    template_id = Column(String(64), default="", comment="模板ID")
    template_params = Column(JSON, default=dict, comment="模板参数")
    ac = Column(Text, default="", comment="验收标准")
    target_dept = Column(String(64), default="", comment="目标组织 / 专家")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_tasks_trace_id", "trace_id"),
        Index("ix_tasks_assignee_org", "assignee_org"),
        Index("ix_tasks_created_at", "created_at"),
        Index("ix_tasks_state", "state"),
        Index("ix_tasks_state_archived", "state", "archived"),
        Index("ix_tasks_updated_at", "updated_at"),
    )

    @staticmethod
    def org_for_state(state: TaskState, assignee_org: str | None = None) -> str:
        if state in {TaskState.Doing, TaskState.Next}:
            return assignee_org or "专家协作组"
        return STATE_ORG_MAP.get(state, assignee_org or "总控中心")

    def to_dict(self) -> dict[str, Any]:
        """序列化为 API 响应，并保留看板所需通用字段。"""

        state_value = self.state.value if isinstance(self.state, TaskState) else str(self.state or "")
        meta = self.meta or {}
        scheduler = self.scheduler or {}
        context_window = meta.get("context_window") or {}
        workspace = meta.get("workspace") or {}
        task_id = str(self.task_id) if self.task_id else ""
        updated_at = self.updated_at.isoformat() if self.updated_at else ""
        final_output = self.output or meta.get("output") or ""

        return {
            "task_id": task_id,
            "trace_id": self.trace_id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "state": state_value,
            "assignee_org": self.assignee_org,
            "creator": self.creator,
            "tags": self.tags or [],
            "meta": meta,
            "flow_log": self.flow_log or [],
            "progress_log": self.progress_log or [],
            "todos": self.todos or [],
            "scheduler": scheduler,
            "contextWindow": context_window,
            "context_window": context_window,
            "created_at": self.created_at.isoformat() if self.created_at else "",
            "updated_at": updated_at,
            "id": task_id,
            "org": self.org or self.org_for_state(self.state, self.assignee_org),
            "owner": self.owner or self.creator,
            "now": self.now or self.description,
            "eta": self.eta if self.eta != "-" else updated_at,
            "block": self.block,
            "output": final_output,
            "archived": self.archived,
            "templateId": self.template_id,
            "templateParams": self.template_params or {},
            "ac": self.ac,
            "targetDept": self.target_dept,
            "_scheduler": scheduler,
            "createdAt": self.created_at.isoformat() if self.created_at else "",
            "updatedAt": updated_at,
            "contextWindowStatus": context_window.get("status", "normal"),
            "contextWindowCompressed": context_window.get("compressed", False),
            "contextWindowArchivePath": context_window.get("archive_path", ""),
            "contextWindowContinuationHint": context_window.get("continuation_hint", False),
            "taskCode": workspace.get("task_code", ""),
            "workspace": workspace,
            "workspacePath": workspace.get("path", ""),
            "workspaceReadmePath": workspace.get("readme_path", ""),
            "workspaceTodoPath": workspace.get("todo_path", ""),
            "workspaceTaskRecordPath": workspace.get("taskrecord_path", ""),
            "workspaceHandoffPath": workspace.get("handoff_path", ""),
            "workspaceLinksPath": workspace.get("links_path", ""),
            "workspaceStatusPath": workspace.get("status_path", ""),
            "workspaceResumeExportPath": workspace.get("resume_export_path", ""),
            "workspaceLatestContextPath": workspace.get("context_latest_path", ""),
            "workspaceActualPath": workspace.get("actual_workspace_path", workspace.get("path", "")),
            "workspaceMetadataMirrorPath": workspace.get("metadata_mirror_path", ""),
            "workspaceStorageTier": workspace.get("storage_tier", "hot"),
            "workspaceProcessingLocation": workspace.get("processing_location", "hot"),
            "workspaceTaskKind": workspace.get("task_kind", "standard"),
            "workspaceTaskPolicy": workspace.get("task_policy", {}),
            "workspaceProjectSizeEstimateGb": workspace.get("project_size_gb_estimate", 0),
            "workspaceArchiveStatus": workspace.get("archive_status", "hot"),
            "workspaceColdArchivePath": workspace.get("cold_archive_path", ""),
            "workspaceReactivationTargetPath": workspace.get("reactivation_target_path", ""),
            "workspaceRefreshRecommended": workspace.get("refresh_recommended", False),
            "workspaceNewRefresh": workspace.get("new_refresh", {}),
            "workspaceLatestSummary": workspace.get("latest_summary", ""),
            "workspaceLatestHandoff": workspace.get("latest_handoff", ""),
            "workspaceLinkedTasks": workspace.get("linked_tasks", []),
            "workspaceWatchdog": workspace.get("watchdog", {}),
            "workspaceNotifications": workspace.get("notifications", []),
            "workspaceRiskControl": workspace.get("risk_control", {}),
            "workspaceFeishuReporting": workspace.get("feishu_reporting", {}),
        }
