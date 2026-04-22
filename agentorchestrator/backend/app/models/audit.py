"""AuditLog 模型 — 独立审计日志表。

记录所有 Agent 和系统对任务的操作，支持 "谁在什么时候对哪个任务做了什么" 查询。
与 flow_log (JSONB 字段) 不同，审计日志是独立表，可跨任务检索。
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, Index, JSON, String, Text

from ..db import Base


class AuditLog(Base):
    """审计日志表。"""

    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    task_id = Column(String(64), nullable=True, comment="关联任务 ID")
    trace_id = Column(String(64), nullable=True, comment="追踪链路 ID")
    agent_id = Column(String(50), nullable=True, comment="执行操作的 Agent")
    action = Column(String(50), nullable=False, comment="操作类型: state/flow/todo/confirm/memory/permission_denied")
    old_value = Column(JSON, nullable=True, comment="变更前状态")
    new_value = Column(JSON, nullable=True, comment="变更后状态")
    reason = Column(Text, default="", comment="操作原因/备注")
    meta = Column(JSON, default=dict, comment="扩展元数据 (tokens, cost, duration)")

    __table_args__ = (
        Index("ix_audit_timestamp", "timestamp"),
        Index("ix_audit_task_id", "task_id"),
        Index("ix_audit_agent_id", "agent_id"),
        Index("ix_audit_action", "action"),
    )
