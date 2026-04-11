from __future__ import annotations

from abc import abstractmethod
from typing import Any, ClassVar, Protocol, TypedDict


class ReplyMeta(TypedDict, total=False):
    channel: str
    channelFamily: str
    policy: str
    effectivePolicy: str
    fallbackMode: str
    transport: str
    parsedFromText: bool
    hasNoReplyPrefix: bool
    hasReplyContext: bool
    markers: list[str]
    availableTargets: list[str]
    targetMessageId: str
    threadId: str
    rootId: str
    chatId: str
    senderId: str
    senderOpenId: str
    sourcePaths: dict[str, str]


class NotificationChannel(Protocol):
    name: ClassVar[str]
    label: ClassVar[str]
    icon: ClassVar[str]
    placeholder: ClassVar[str]
    allowed_domains: ClassVar[tuple[str, ...]]

    @classmethod
    @abstractmethod
    def validate_webhook(cls, webhook: str) -> bool:
        ...

    @classmethod
    @abstractmethod
    def send(
        cls,
        webhook: str,
        title: str,
        content: str,
        url: str | None = None,
        reply_meta: ReplyMeta | None = None,
        extra: dict[str, Any] | None = None,
    ) -> bool:
        ...

    @classmethod
    def _validate_url_scheme(cls, url: str) -> bool:
        return url.startswith('https://')

    @classmethod
    def _extract_domain(cls, url: str) -> str:
        try:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            return parsed.netloc.lower()
        except Exception:
            return ''
