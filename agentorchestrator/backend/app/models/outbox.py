"""OutboxEvent 模型 — Transactional Outbox Pattern。

事件先与业务数据写入同一事务，再由 OutboxRelay worker 异步投递到 Redis Streams。
消灭 DB/Event 双写不一致问题：
- create_task: flush→publish→commit 中 publish 失败导致操作白费
- transition_state: 先 publish 后 commit，commit 失败产生幽灵事件
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from ..db import Base


class OutboxEvent(Base):
    """发件箱表 — 事件先写 DB，再由专用 worker 投递到 Redis。"""

    __tablename__ = "outbox_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    event_id = Column(
        String(64),
        default=lambda: str(uuid.uuid4()),
        nullable=False,
        unique=True,
    )
    topic = Column(String(100), nullable=False, comment="目标 Redis Stream topic")
    trace_id = Column(String(64), nullable=False)
    event_type = Column(String(100), nullable=False)
    producer = Column(String(100), nullable=False)
    payload = Column(JSONB, default=dict)
    meta = Column(JSONB, default=dict)
    published = Column(Boolean, default=False, index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    attempts = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_outbox_unpublished", "published", "id", postgresql_where="published = false"),
        Index("ix_outbox_created_at", "created_at"),
    )
