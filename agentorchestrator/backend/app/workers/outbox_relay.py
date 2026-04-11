"""Outbox Relay Worker — 轮询 outbox_events 表，投递未发布事件到 Redis Streams。

Transactional Outbox Pattern 的投递端：
- 事务层把事件写入 outbox 表（与业务数据同一事务）
- 本 worker 轮询 unpublished 事件，调用 EventBus.publish 投递到 Redis
- 投递成功标记 published=True；失败累计 attempts，达到上限进入 DLQ
- 消费者必须用 event_id 做幂等，防止 relay 重启造成重复投递
"""

import asyncio
import logging
import signal
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..db import async_session
from ..models.outbox import OutboxEvent
from ..services.event_bus import EventBus

log = logging.getLogger("agentorchestrator.outbox_relay")

MAX_ATTEMPTS = 5
BATCH_SIZE = 50
POLL_INTERVAL = 1.0  # 秒


class OutboxRelay:
    """轮询 outbox_events 表，投递到 Redis Streams。"""

    def __init__(self):
        self.bus = EventBus()
        self._running = False

    async def start(self):
        await self.bus.connect()
        self._running = True
        log.info("🚀 Outbox Relay started")

        while self._running:
            try:
                relayed = await self._relay_cycle()
                if relayed == 0:
                    await asyncio.sleep(POLL_INTERVAL)
            except Exception as e:
                log.error(f"Outbox relay error: {e}", exc_info=True)
                await asyncio.sleep(POLL_INTERVAL * 2)

    async def stop(self):
        self._running = False
        await self.bus.close()
        log.info("Outbox Relay stopped")

    async def _relay_cycle(self) -> int:
        """处理一批未投递事件。返回本轮处理数量。"""
        async with async_session() as db:
            # FOR UPDATE SKIP LOCKED 允许多 relay 实例并行
            stmt = (
                select(OutboxEvent)
                .where(OutboxEvent.published == False)  # noqa: E712
                .order_by(OutboxEvent.id)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
            result = await db.execute(stmt)
            events = list(result.scalars().all())

            if not events:
                return 0

            for event in events:
                try:
                    await self.bus.publish(
                        topic=event.topic,
                        trace_id=event.trace_id,
                        event_type=event.event_type,
                        producer=event.producer,
                        payload=event.payload or {},
                        meta=event.meta or {},
                    )
                    event.published = True
                    event.published_at = datetime.now(timezone.utc)
                    log.debug(f"📤 Relayed outbox #{event.id} → {event.topic}")

                except Exception as exc:
                    event.attempts += 1
                    event.last_error = str(exc)[:500]
                    log.warning(
                        f"Outbox #{event.id} relay failed (attempt {event.attempts}): {exc}"
                    )

                    if event.attempts >= MAX_ATTEMPTS:
                        # 投递到 DLQ
                        try:
                            await self.bus.publish(
                                topic="dead_letter",
                                trace_id=event.trace_id,
                                event_type="outbox.dead_letter",
                                producer="outbox_relay",
                                payload={
                                    "outbox_id": event.id,
                                    "event_id": event.event_id,
                                    "topic": event.topic,
                                    "event_type": event.event_type,
                                    "payload": event.payload,
                                    "error": event.last_error,
                                    "attempts": event.attempts,
                                },
                            )
                        except Exception as dlq_err:
                            log.error(f"Failed to publish DLQ for outbox #{event.id}: {dlq_err}")

            await db.commit()
            return len(events)


async def run_outbox_relay():
    """入口函数 — 用于直接运行 worker。"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    relay = OutboxRelay()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(relay.stop()))

    await relay.start()


if __name__ == "__main__":
    asyncio.run(run_outbox_relay())
