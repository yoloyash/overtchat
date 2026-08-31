"""OvertChat security and routing hooks around the pinned realtime engine."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

API_KEY_PROTOCOL_PREFIX = "openai-insecure-api-key."


class _SessionModelFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.getMessage().startswith("Session model set to:"):
            record.msg = "Session model set from authenticated voice ticket"
            record.args = ()
        return True


def _decode_urlsafe(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def valid_ticket(token: str, secret: str, now: float | None = None) -> bool:
    try:
        encoded_payload, encoded_signature = token.split(".")
        signature = _decode_urlsafe(encoded_signature)
        expected = hmac.new(
            secret.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected):
            return False
        payload = json.loads(_decode_urlsafe(encoded_payload))
    except (ValueError, UnicodeError, json.JSONDecodeError):
        return False
    current = int(time.time() if now is None else now)
    return bool(
        isinstance(payload, dict)
        and payload.get("version") == 1
        and isinstance(payload.get("connectBy"), int)
        and payload["connectBy"] >= current
        and isinstance(payload.get("expiresAt"), int)
        and payload["expiresAt"] >= payload["connectBy"]
        and isinstance(payload.get("userId"), str)
        and payload["userId"]
        and isinstance(payload.get("modelConfigId"), str)
        and payload["modelConfigId"]
    )


def _websocket_ticket(scope: dict[str, Any]) -> str | None:
    headers = dict(scope.get("headers") or [])
    raw = headers.get(b"sec-websocket-protocol", b"").decode("latin-1")
    for protocol in (value.strip() for value in raw.split(",")):
        if protocol.startswith(API_KEY_PROTOCOL_PREFIX):
            return protocol.removeprefix(API_KEY_PROTOCOL_PREFIX)
    return None


class VoiceTicketMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]], secret: str) -> None:
        self.app = app
        self.secret = secret

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") == "websocket" and scope.get("path") == "/v1/realtime":
            ticket = _websocket_ticket(scope)
            if ticket is None or not valid_ticket(ticket, self.secret):
                await send(
                    {
                        "type": "websocket.close",
                        "code": 1008,
                        "reason": "Voice ticket expired or invalid",
                    }
                )
                return
        await self.app(scope, receive, send)


def install_runtime_hooks(secret: str) -> None:
    """Add auth and route each pipeline request to its ticket-selected model."""
    from speech_to_speech.LLM.base_openai_compatible_language_model import (
        BaseOpenAICompatibleHandler,
    )
    from speech_to_speech.api.openai_realtime import server as server_module

    original_create_app = server_module.create_app
    original_process = BaseOpenAICompatibleHandler.process
    logging.getLogger(
        "speech_to_speech.api.openai_realtime.handlers.session"
    ).addFilter(_SessionModelFilter())

    def create_authenticated_app(*args: Any, **kwargs: Any) -> VoiceTicketMiddleware:
        return VoiceTicketMiddleware(original_create_app(*args, **kwargs), secret)

    def process_with_session_model(self: Any, request: Any):
        session = request.runtime_config.session
        model = getattr(session, "model", None)
        if isinstance(model, str) and model and model != "overtchat":
            self.model_name = model
        yield from original_process(self, request)

    server_module.create_app = create_authenticated_app
    BaseOpenAICompatibleHandler.process = process_with_session_model
