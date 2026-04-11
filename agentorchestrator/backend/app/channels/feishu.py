from __future__ import annotations

import json
from typing import Any, ClassVar
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .base import NotificationChannel, ReplyMeta


class FeishuChannel(NotificationChannel):
    name: ClassVar[str] = 'feishu'
    label: ClassVar[str] = '飞书 Feishu'
    icon: ClassVar[str] = '💬'
    placeholder: ClassVar[str] = 'https://open.feishu.cn/open-apis/bot/v2/hook/...'
    allowed_domains: ClassVar[tuple[str, ...]] = ('open.feishu.cn', 'open.larksuite.com')

    POLICY_LABELS: ClassVar[dict[str, str]] = {
        'send': '普通发送',
        'no_reply': '禁止自动回复',
        'reply_current': '回复当前消息',
        'reply_thread': '在线程内回复',
        'reply_root': '回复根消息',
    }

    @classmethod
    def validate_webhook(cls, webhook: str) -> bool:
        if not cls._validate_url_scheme(webhook):
            return False
        domain = cls._extract_domain(webhook)
        return any(domain.endswith(d) for d in cls.allowed_domains)

    @classmethod
    def _build_reply_context_lines(cls, reply_meta: ReplyMeta | None) -> list[str]:
        if not reply_meta:
            return []

        policy = str(reply_meta.get('effectivePolicy') or reply_meta.get('policy') or 'send')
        lines = [f"**回复策略**：{cls.POLICY_LABELS.get(policy, policy)}"]

        target_parts: list[str] = []
        if reply_meta.get('targetMessageId'):
            target_parts.append(f"message={reply_meta['targetMessageId']}")
        if reply_meta.get('threadId'):
            target_parts.append(f"thread={reply_meta['threadId']}")
        if reply_meta.get('rootId'):
            target_parts.append(f"root={reply_meta['rootId']}")
        if reply_meta.get('chatId'):
            target_parts.append(f"chat={reply_meta['chatId']}")
        if target_parts:
            lines.append(f"**回复目标**：`{' | '.join(target_parts)}`")

        markers = reply_meta.get('markers') or []
        if markers:
            marker_text = '、'.join(str(item) for item in markers if item)
            if marker_text:
                lines.append(f"**意图标记**：{marker_text}")

        fallback_mode = str(reply_meta.get('fallbackMode') or 'none')
        if fallback_mode and fallback_mode != 'none':
            lines.append(f"**降级策略**：{fallback_mode}")

        if reply_meta.get('parsedFromText'):
            lines.append('**来源**：由会话文本标记解析得到')

        return lines

    @classmethod
    def _build_payload(
        cls,
        title: str,
        content: str,
        url: str | None = None,
        reply_meta: ReplyMeta | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        elements: list[dict[str, Any]] = [
            {'tag': 'div', 'text': {'tag': 'lark_md', 'content': content}}
        ]

        context_lines = cls._build_reply_context_lines(reply_meta)
        if context_lines:
            elements.append({
                'tag': 'div',
                'text': {'tag': 'lark_md', 'content': '\n'.join(context_lines)},
            })

        if url:
            elements.append({
                'tag': 'action',
                'actions': [{
                    'tag': 'button',
                    'text': {'tag': 'plain_text', 'content': '查看详情'},
                    'url': url,
                    'type': 'primary',
                }],
            })

        payload: dict[str, Any] = {
            'msg_type': 'interactive',
            'card': {
                'header': {
                    'title': {'tag': 'plain_text', 'content': title},
                    'template': 'blue',
                },
                'elements': elements,
            },
        }

        if reply_meta:
            payload['manus_reply_meta'] = dict(reply_meta)
        if extra:
            payload['manus_extra'] = extra
        return payload

    @classmethod
    def send(
        cls,
        webhook: str,
        title: str,
        content: str,
        url: str | None = None,
        reply_meta: ReplyMeta | None = None,
        extra: dict[str, Any] | None = None,
    ) -> bool:
        payload = json.dumps(
            cls._build_payload(title=title, content=content, url=url, reply_meta=reply_meta, extra=extra),
            ensure_ascii=False,
        ).encode('utf-8')
        try:
            req = Request(webhook, data=payload, headers={'Content-Type': 'application/json; charset=utf-8'})
            resp = urlopen(req, timeout=10)
            return resp.status == 200
        except (URLError, HTTPError, Exception):
            return False
