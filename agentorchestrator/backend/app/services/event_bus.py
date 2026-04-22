"""事件总线实现。

默认策略：
1. 本地默认使用 SQLite，保证 freshly synced 仓库无需额外数据库即可启动。
2. 仅当用户显式提供 MYSQL_URL 时，才启用 MySQL 作为事件总线后端。
3. SQLite 模式用于本地单机联调；MySQL 模式保留给显式配置的正式环境。

能力语义保持与旧接口一致：
- publish: 写入 event_bus_messages
- consume: 按 consumer group offset 拉取消息
- ack: 更新 group ack offset
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from ..config import get_settings

log = logging.getLogger("agentorchestrator.event_bus")

# ── 标准 Topic 常量 ──
TOPIC_TASK_CREATED = "task.created"
TOPIC_TASK_PLANNING_REQUEST = "task.planning.request"
TOPIC_TASK_PLANNING_COMPLETE = "task.planning.complete"
TOPIC_TASK_REVIEW_REQUEST = "task.review.request"
TOPIC_TASK_REVIEW_RESULT = "task.review.result"
TOPIC_TASK_DISPATCH = "task.dispatch"
TOPIC_TASK_STATUS = "task.status"
TOPIC_TASK_COMPLETED = "task.completed"
TOPIC_TASK_CLOSED = "task.closed"
TOPIC_TASK_REPLAN = "task.replan"
TOPIC_TASK_STALLED = "task.stalled"
TOPIC_TASK_ESCALATED = "task.escalated"

TOPIC_AGENT_THOUGHTS = "agent.thoughts"
TOPIC_AGENT_TODO_UPDATE = "agent.todo.update"
TOPIC_AGENT_HEARTBEAT = "agent.heartbeat"


def _resolve_project_root() -> pathlib.Path:
    settings = get_settings()
    if settings.openclaw_project_dir:
        return pathlib.Path(settings.openclaw_project_dir)
    return pathlib.Path(__file__).resolve().parents[4]


def _sqlite_url() -> str:
    settings = get_settings()
    db_path = pathlib.Path(settings.sqlite_event_bus_path)
    if not db_path.is_absolute():
        db_path = settings.project_root / db_path
    db_path = db_path.resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return settings.sqlite_event_bus_url


def _timestamp_now_for_backend(kind: str) -> Any:
    now = datetime.now(timezone.utc)
    if kind == "sqlite":
        return now.isoformat()
    return now.replace(tzinfo=None)


def _normalize_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return None
        try:
            parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.isoformat()
        except ValueError:
            return text_value
    return str(value)


class EventBus:
    """SQLite 默认、MySQL 可选的事件总线实现。"""

    def __init__(self, mysql_url: str | None = None):
        settings = get_settings()
        self._settings = settings
        self._mysql_url = mysql_url or settings.mysql_url
        self._explicit_mysql = bool(mysql_url or settings.mysql_url_override or os.getenv("MYSQL_URL"))
        self._engine: AsyncEngine | None = None
        self._session_factory: async_sessionmaker | None = None
        self._backend_kind: str | None = None
        self._backend_url: str | None = None

    async def connect(self):
        if self._engine is not None:
            return

        if self._explicit_mysql:
            await self._connect_with_backend(self._mysql_url, "mysql")
            return

        await self._connect_with_backend(_sqlite_url(), "sqlite")

    async def _connect_with_backend(self, url: str, kind: str):
        engine = create_async_engine(url, pool_pre_ping=(kind == "mysql"))
        try:
            self._engine = engine
            self._session_factory = async_sessionmaker(engine, expire_on_commit=False)
            self._backend_kind = kind
            self._backend_url = url
            await self._ensure_tables()
            log.info("EventBus connected to %s: %s", kind, url)
        except Exception:
            await engine.dispose()
            self._engine = None
            self._session_factory = None
            self._backend_kind = None
            self._backend_url = None
            raise

    async def close(self):
        if self._engine:
            await self._engine.dispose()
            self._engine = None
            self._session_factory = None
            self._backend_kind = None
            self._backend_url = None

    @property
    def engine(self) -> AsyncEngine:
        assert self._engine is not None, "EventBus not connected. Call connect() first."
        return self._engine

    @property
    def backend_kind(self) -> str:
        assert self._backend_kind is not None, "EventBus backend unavailable. Call connect() first."
        return self._backend_kind

    async def _ensure_tables(self):
        if self.backend_kind == "sqlite":
            ddl_messages = """
            CREATE TABLE IF NOT EXISTS event_bus_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                topic TEXT NOT NULL,
                event_type TEXT NOT NULL,
                producer TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                meta_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
            ddl_messages_index = """
            CREATE INDEX IF NOT EXISTS idx_event_bus_topic_id
            ON event_bus_messages(topic, id);
            """
            ddl_offsets = """
            CREATE TABLE IF NOT EXISTS event_bus_offsets (
                topic TEXT NOT NULL,
                consumer_group TEXT NOT NULL,
                last_delivered_id INTEGER NOT NULL DEFAULT 0,
                last_acked_id INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (topic, consumer_group)
            );
            """
        else:
            ddl_messages = """
            CREATE TABLE IF NOT EXISTS event_bus_messages (
                id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                event_id VARCHAR(64) NOT NULL,
                trace_id VARCHAR(128) NOT NULL,
                topic VARCHAR(128) NOT NULL,
                event_type VARCHAR(128) NOT NULL,
                producer VARCHAR(128) NOT NULL,
                payload_json JSON NOT NULL,
                meta_json JSON NOT NULL,
                created_at DATETIME(6) NOT NULL,
                INDEX idx_event_bus_topic_id (topic, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
            ddl_messages_index = None
            ddl_offsets = """
            CREATE TABLE IF NOT EXISTS event_bus_offsets (
                topic VARCHAR(128) NOT NULL,
                consumer_group VARCHAR(128) NOT NULL,
                last_delivered_id BIGINT NOT NULL DEFAULT 0,
                last_acked_id BIGINT NOT NULL DEFAULT 0,
                updated_at DATETIME(6) NOT NULL,
                PRIMARY KEY (topic, consumer_group)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """

        async with self.engine.begin() as conn:
            await conn.execute(text(ddl_messages))
            if ddl_messages_index:
                await conn.execute(text(ddl_messages_index))
            await conn.execute(text(ddl_offsets))

    def _normalize_entry_id(self, entry_id: str) -> int:
        id_text = str(entry_id).split("-", 1)[0]
        return int(id_text)

    async def publish(
        self,
        topic: str,
        trace_id: str,
        event_type: str,
        producer: str,
        payload: dict[str, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> str:
        event = {
            "event_id": str(uuid.uuid4()),
            "trace_id": trace_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "topic": topic,
            "event_type": event_type,
            "producer": producer,
            "payload": payload or {},
            "meta": meta or {},
        }

        if self.backend_kind == "sqlite":
            stmt = text(
                """
                INSERT INTO event_bus_messages(
                    event_id, trace_id, topic, event_type, producer,
                    payload_json, meta_json, created_at
                ) VALUES (
                    :event_id, :trace_id, :topic, :event_type, :producer,
                    :payload_json, :meta_json, :created_at
                )
                """
            )
        else:
            stmt = text(
                """
                INSERT INTO event_bus_messages(
                    event_id, trace_id, topic, event_type, producer,
                    payload_json, meta_json, created_at
                ) VALUES (
                    :event_id, :trace_id, :topic, :event_type, :producer,
                    CAST(:payload_json AS JSON), CAST(:meta_json AS JSON), :created_at
                )
                """
            )

        async with self.engine.begin() as conn:
            result = await conn.execute(
                stmt,
                {
                    "event_id": event["event_id"],
                    "trace_id": trace_id,
                    "topic": topic,
                    "event_type": event_type,
                    "producer": producer,
                    "payload_json": json.dumps(event["payload"], ensure_ascii=False),
                    "meta_json": json.dumps(event["meta"], ensure_ascii=False),
                    "created_at": _timestamp_now_for_backend(self.backend_kind),
                },
            )
            entry_id = str(result.lastrowid)

        log.debug("📤 Published %s/%s [%s] trace=%s", topic, event_type, entry_id, trace_id)
        return entry_id

    async def ensure_consumer_group(self, topic: str, group: str):
        if self.backend_kind == "sqlite":
            stmt = text(
                """
                INSERT INTO event_bus_offsets(topic, consumer_group, last_delivered_id, last_acked_id, updated_at)
                VALUES(:topic, :consumer_group, 0, 0, :updated_at)
                ON CONFLICT(topic, consumer_group)
                DO UPDATE SET updated_at = excluded.updated_at
                """
            )
        else:
            stmt = text(
                """
                INSERT INTO event_bus_offsets(topic, consumer_group, last_delivered_id, last_acked_id, updated_at)
                VALUES(:topic, :consumer_group, 0, 0, :updated_at)
                ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
                """
            )

        async with self.engine.begin() as conn:
            await conn.execute(
                stmt,
                {
                    "topic": topic,
                    "consumer_group": group,
                    "updated_at": _timestamp_now_for_backend(self.backend_kind),
                },
            )

    async def consume(
        self,
        topic: str,
        group: str,
        consumer: str,
        count: int = 10,
        block_ms: int = 5000,
    ) -> list[tuple[str, dict]]:
        await self.ensure_consumer_group(topic, group)

        fetch_offset = text(
            "SELECT last_delivered_id FROM event_bus_offsets WHERE topic=:topic AND consumer_group=:consumer_group"
        )
        fetch_messages = text(
            """
            SELECT id, event_id, trace_id, topic, event_type, producer, payload_json, meta_json, created_at
            FROM event_bus_messages
            WHERE topic=:topic AND id > :last_id
            ORDER BY id ASC
            LIMIT :limit_count
            """
        )
        update_offset = text(
            """
            UPDATE event_bus_offsets
            SET last_delivered_id=:last_id, updated_at=:updated_at
            WHERE topic=:topic AND consumer_group=:consumer_group
            """
        )

        async with self.engine.begin() as conn:
            offset_res = await conn.execute(fetch_offset, {"topic": topic, "consumer_group": group})
            last_id = int(offset_res.scalar() or 0)

            rows = (
                await conn.execute(
                    fetch_messages,
                    {"topic": topic, "last_id": last_id, "limit_count": count},
                )
            ).mappings().all()

            if rows:
                newest = int(rows[-1]["id"])
                await conn.execute(
                    update_offset,
                    {
                        "last_id": newest,
                        "updated_at": _timestamp_now_for_backend(self.backend_kind),
                        "topic": topic,
                        "consumer_group": group,
                    },
                )

        events: list[tuple[str, dict]] = []
        for row in rows:
            events.append(
                (
                    str(row["id"]),
                    {
                        "event_id": row["event_id"],
                        "trace_id": row["trace_id"],
                        "timestamp": _normalize_timestamp(row["created_at"]),
                        "topic": row["topic"],
                        "event_type": row["event_type"],
                        "producer": row["producer"],
                        "payload": row["payload_json"] if isinstance(row["payload_json"], dict) else json.loads(row["payload_json"] or "{}"),
                        "meta": row["meta_json"] if isinstance(row["meta_json"], dict) else json.loads(row["meta_json"] or "{}"),
                    },
                )
            )

        if not rows and block_ms > 0:
            import asyncio

            await asyncio.sleep(min(block_ms / 1000.0, 2.0))
        return events

    async def ack(self, topic: str, group: str, entry_id: str):
        ack_id = self._normalize_entry_id(entry_id)
        stmt = text(
            """
            UPDATE event_bus_offsets
            SET last_acked_id = MAX(last_acked_id, :ack_id), updated_at=:updated_at
            WHERE topic=:topic AND consumer_group=:consumer_group
            """
        )
        async with self.engine.begin() as conn:
            await conn.execute(
                stmt,
                {
                    "ack_id": ack_id,
                    "updated_at": _timestamp_now_for_backend(self.backend_kind),
                    "topic": topic,
                    "consumer_group": group,
                },
            )

    async def get_pending(self, topic: str, group: str, count: int = 10) -> list:
        stmt = text(
            """
            SELECT m.id
            FROM event_bus_messages m
            JOIN event_bus_offsets o ON o.topic = m.topic
            WHERE m.topic=:topic
              AND o.consumer_group=:consumer_group
              AND m.id > o.last_acked_id
              AND m.id <= o.last_delivered_id
            ORDER BY m.id ASC
            LIMIT :limit_count
            """
        )
        async with self.engine.begin() as conn:
            rows = (await conn.execute(stmt, {"topic": topic, "consumer_group": group, "limit_count": count})).mappings().all()
        return [
            {
                "message_id": str(r["id"]),
                "consumer": group,
                "time_since_delivered": 0,
                "times_delivered": 1,
            }
            for r in rows
        ]

    async def claim_stale(
        self,
        topic: str,
        group: str,
        consumer: str,
        min_idle_ms: int = 60000,
        count: int = 10,
    ) -> list[tuple[str, dict]]:
        return await self.consume(topic, group, consumer, count=count, block_ms=0)

    async def stream_info(self, topic: str) -> dict:
        stmt = text("SELECT COUNT(*) AS total FROM event_bus_messages WHERE topic=:topic")
        offset_stmt = text(
            "SELECT last_delivered_id, last_acked_id FROM event_bus_offsets WHERE topic=:topic"
        )
        async with self.engine.begin() as conn:
            total = int((await conn.execute(stmt, {"topic": topic})).scalar() or 0)
            offsets = (await conn.execute(offset_stmt, {"topic": topic})).mappings().all()
        return {
            "topic": topic,
            "length": total,
            "consumer_groups": len(offsets),
            "offsets": [dict(o) for o in offsets],
        }

    async def consume_multi(
        self,
        topics: list[str],
        group: str,
        consumer: str,
        count: int = 10,
        block_ms: int = 2000,
    ) -> list[tuple[str, str, dict]]:
        events: list[tuple[str, str, dict]] = []
        per_topic = max(1, count // max(1, len(topics)))
        for topic in topics:
            topic_events = await self.consume(topic, group, consumer, count=per_topic, block_ms=0)
            for entry_id, data in topic_events:
                events.append((topic, entry_id, data))
        if not events and block_ms > 0:
            import asyncio

            await asyncio.sleep(min(block_ms / 1000.0, 2.0))
        return events[:count]

    async def publish_batch(self, events: list[dict]) -> list[str]:
        entry_ids: list[str] = []
        for evt in events:
            entry_id = await self.publish(
                topic=evt["topic"],
                trace_id=evt["trace_id"],
                event_type=evt["event_type"],
                producer=evt["producer"],
                payload=evt.get("payload", {}),
                meta=evt.get("meta", {}),
            )
            entry_ids.append(entry_id)
        return entry_ids

    async def get_delivery_count(self, topic: str, group: str, entry_id: str) -> int:
        return 1

    async def poll_since(
        self,
        since_id: int,
        topic: str | None = None,
        limit: int = 200,
    ) -> list[tuple[str, dict]]:
        if topic:
            stmt = text(
                """
                SELECT id, event_id, trace_id, topic, event_type, producer, payload_json, meta_json, created_at
                FROM event_bus_messages
                WHERE id > :since_id AND topic=:topic
                ORDER BY id ASC LIMIT :limit_count
                """
            )
            params = {"since_id": since_id, "topic": topic, "limit_count": limit}
        else:
            stmt = text(
                """
                SELECT id, event_id, trace_id, topic, event_type, producer, payload_json, meta_json, created_at
                FROM event_bus_messages
                WHERE id > :since_id
                ORDER BY id ASC LIMIT :limit_count
                """
            )
            params = {"since_id": since_id, "limit_count": limit}

        async with self.engine.begin() as conn:
            rows = (await conn.execute(stmt, params)).mappings().all()

        return [
            (
                str(r["id"]),
                {
                    "event_id": r["event_id"],
                    "trace_id": r["trace_id"],
                    "timestamp": _normalize_timestamp(r["created_at"]),
                    "topic": r["topic"],
                    "event_type": r["event_type"],
                    "producer": r["producer"],
                    "payload": r["payload_json"] if isinstance(r["payload_json"], dict) else json.loads(r["payload_json"] or "{}"),
                    "meta": r["meta_json"] if isinstance(r["meta_json"], dict) else json.loads(r["meta_json"] or "{}"),
                },
            )
            for r in rows
        ]


_bus: EventBus | None = None


async def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
        await _bus.connect()
    return _bus
