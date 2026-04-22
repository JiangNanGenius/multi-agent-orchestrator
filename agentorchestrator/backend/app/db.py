"""SQLAlchemy async 引擎与 session 管理。"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

_engine_kwargs = {
    "echo": settings.debug,
}
if not settings.database_url.startswith("sqlite"):
    _engine_kwargs.update(
        {
            "pool_size": 10,
            "max_overflow": 20,
            "pool_pre_ping": True,
        }
    )

engine = create_async_engine(settings.database_url, **_engine_kwargs)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""

    pass


async def get_db() -> AsyncSession:
    """FastAPI 依赖注入 — 获取异步数据库 session。

    提交策略：由服务层显式 commit/flush 控制，
    此处仅负责异常时 rollback，避免双重提交。
    """

    async with async_session() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def _migrate_sqlite_outbox_if_needed(conn) -> None:
    """修复 SQLite 下历史 outbox_events 表使用 BIGINT 主键无法自增的问题。"""

    if conn.dialect.name != "sqlite":
        return

    rows = conn.execute(text("PRAGMA table_info('outbox_events')")).mappings().all()
    if not rows:
        return

    id_col = next((row for row in rows if row["name"] == "id"), None)
    if id_col and str(id_col.get("type") or "").upper() == "INTEGER":
        return

    conn.execute(text("DROP TABLE IF EXISTS outbox_events__mig"))
    conn.execute(
        text(
            """
            CREATE TABLE outbox_events__mig (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME NOT NULL,
                event_id VARCHAR(64) NOT NULL UNIQUE,
                topic VARCHAR(100) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                producer VARCHAR(100) NOT NULL,
                payload JSON,
                meta JSON,
                published BOOLEAN,
                published_at DATETIME,
                attempts INTEGER,
                last_error TEXT
            )
            """
        )
    )
    conn.execute(
        text(
            """
            INSERT INTO outbox_events__mig (
                id, created_at, event_id, topic, trace_id, event_type,
                producer, payload, meta, published, published_at, attempts, last_error
            )
            SELECT
                COALESCE(id, rowid), created_at, event_id, topic, trace_id, event_type,
                producer, payload, meta, published, published_at, attempts, last_error
            FROM outbox_events
            ORDER BY COALESCE(id, rowid)
            """
        )
    )
    conn.execute(text("DROP TABLE outbox_events"))
    conn.execute(text("ALTER TABLE outbox_events__mig RENAME TO outbox_events"))
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_outbox_created_at ON outbox_events (created_at)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_outbox_unpublished ON outbox_events (published, id) WHERE published = 0"
        )
    )


async def init_db():
    """开发用 — 创建所有表（生产用 Alembic）。"""

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_sqlite_outbox_if_needed)
