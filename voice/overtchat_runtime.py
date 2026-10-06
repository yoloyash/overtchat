"""OvertChat security and routing hooks around the pinned realtime engine."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from contextvars import ContextVar
from copy import copy, deepcopy
from dataclasses import dataclass, field
from collections.abc import Awaitable, Callable
from typing import Any

API_KEY_PROTOCOL_PREFIX = "openai-insecure-api-key."


@dataclass
class VoiceConnection:
    ticket: str
    items: dict[str, dict[str, Any]] = field(default_factory=dict)
    history_ids: dict[str, set[str]] = field(default_factory=dict)
    audio_ms: dict[str, float] = field(default_factory=dict)

    def observe(self, event: dict[str, Any]) -> None:
        """Retain protocol items for SDK retrieval, independently of engine IDs."""
        kind = event.get("type")
        item_id = event.get("item_id")
        if kind == "response.output_audio.delta" and isinstance(item_id, str):
            self.audio_ms[item_id] = self.audio_ms.get(item_id, 0) + len(
                base64.b64decode(event["delta"])
            ) / 48  # mono PCM16 at 24 kHz
        items = []
        if kind in ("conversation.item.created", "response.output_item.done"):
            items = [event.get("item")]
        elif kind == "response.done":
            items = event.get("response", {}).get("output") or []
        elif kind == "conversation.item.input_audio_transcription.completed":
            items = [{
                "id": item_id, "type": "message", "role": "user",
                "status": "completed",
                "content": [{"type": "input_audio", "transcript": event["transcript"]}],
            }]
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                self.items[item["id"]] = deepcopy(item)
        # Only recent items can still be in playback. Bound the retrieval cache.
        while len(self.items) > 512:
            oldest = next(iter(self.items))
            self.items.pop(oldest)
            self.history_ids.pop(oldest, None)
            self.audio_ms.pop(oldest, None)


_connection: ContextVar[VoiceConnection | None] = ContextVar("voice_connection", default=None)


def _voice_connection(runtime_config: Any) -> VoiceConnection:
    connection = getattr(runtime_config, "_overtchat_connection", None)
    if not isinstance(connection, VoiceConnection):
        raise RuntimeError("Voice request has no authenticated connection")
    return connection


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
            connection = VoiceConnection(ticket)
            context_token = _connection.set(connection)

            async def observe_send(message: dict[str, Any]) -> None:
                if message.get("type") == "websocket.send" and message.get("text"):
                    connection.observe(json.loads(message["text"]))
                await send(message)

            try:
                await self.app(scope, receive, observe_send)
            finally:
                _connection.reset(context_token)
            return
        await self.app(scope, receive, send)


def install_runtime_hooks(secret: str) -> None:
    """Add auth and route each pipeline request to its ticket-selected model."""
    from speech_to_speech.LLM.base_openai_compatible_language_model import (
        BaseOpenAICompatibleHandler,
    )
    from speech_to_speech.api.openai_realtime import server as server_module
    from speech_to_speech.api.openai_realtime.service import RealtimeService

    original_create_app = server_module.create_app
    original_process = BaseOpenAICompatibleHandler.process
    original_register = RealtimeService.register
    original_update = RealtimeService.handle_session_update
    logging.getLogger(
        "speech_to_speech.api.openai_realtime.handlers.session"
    ).addFilter(_SessionModelFilter())

    def create_authenticated_app(*args: Any, **kwargs: Any) -> VoiceTicketMiddleware:
        return VoiceTicketMiddleware(original_create_app(*args, **kwargs), secret)

    def process_with_session_model(self: Any, request: Any):
        # The handler is pooled, and speculative provider workers can outlive a
        # request. Give each invocation its own model field; never mutate the
        # pooled handler or derive authorization from browser session config.
        handler = copy(self)
        handler.model_name = _voice_connection(request.runtime_config).ticket
        yield from original_process(handler, request)

    def register_authenticated_session(self: Any) -> str:
        connection = _connection.get()
        if connection is None:
            raise RuntimeError("Voice session has no authenticated connection")
        conn_id = original_register(self)
        config = self._state(conn_id).runtime_config
        object.__setattr__(config, "_overtchat_connection", connection)
        config.session.model = connection.ticket
        return conn_id

    def update_authenticated_session(self: Any, conn_id: str, event: Any):
        connection = _voice_connection(self._state(conn_id).runtime_config)
        model = getattr(event.session, "model", None)
        if model is not None and model != connection.ticket:
            return self.make_error("The voice session model cannot be changed.", "invalid_session_model")
        return original_update(self, conn_id, event)

    server_module.create_app = create_authenticated_app
    BaseOpenAICompatibleHandler.process = process_with_session_model
    RealtimeService.register = register_authenticated_session
    RealtimeService.handle_session_update = update_authenticated_session
    _install_playback_hooks()


def _install_playback_hooks() -> None:
    """Fill the pinned engine's retrieve/truncate gap using Realtime events.

    It generates different IDs for model-history text and wire audio items.
    Capture that correspondence before response finalization drops it. There
    are no word timestamps: truncation clears the interrupted item's entire
    transcript, as opposed to inventing a supposedly heard text prefix.
    """
    from openai.types.realtime import ConversationItemTruncatedEvent
    from pydantic import BaseModel
    from speech_to_speech.api.openai_realtime import websocket_router
    from speech_to_speech.api.openai_realtime.handlers.response import ResponseHandler

    original_finish = ResponseHandler.finish_response
    original_dispatch = websocket_router._dispatch_client_event

    class RetrievedItemEvent(BaseModel):
        # The pinned Python SDK has the request but lacks this server event.
        type: str = "conversation.item.retrieved"
        event_id: str
        item: dict[str, Any]

    def finish_response(self: Any, conn_id: str, *args: Any, **kwargs: Any):
        state = self._state(conn_id)
        connection = _voice_connection(state.runtime_config)
        chat = state.runtime_config.chat
        with chat._lock:
            tracked, _ = chat._provisional_generations.get(state.current_response_key, (set(), set()))
            history_ids = [item.id for item in chat.buffer
                           if item.id in tracked and getattr(item, "role", None) == "assistant"]
        wire_ids = [str(item["item_id"]) for item in state.pending_text_outputs]
        for index, item_id in enumerate(wire_ids):
            # Text is grouped between tool calls in both representations. If a
            # provider groups differently, conservatively discard that response's
            # text on interruption, preserving function calls and their results.
            connection.history_ids[item_id] = (
                {history_ids[index]} if len(history_ids) == len(wire_ids) else set(history_ids)
            )
        return original_finish(self, conn_id, *args, **kwargs)

    async def dispatch(unit: Any, session_id: str, raw: dict[str, Any], transport: Any,
                       transport_kind: str = "websocket") -> None:
        kind = raw.get("type")
        if kind not in ("conversation.item.retrieve", "conversation.item.truncate"):
            await original_dispatch(unit, session_id, raw, transport, transport_kind=transport_kind)
            return
        service = unit.service
        config = service._state(session_id).runtime_config
        connection = _voice_connection(config)
        item_id = raw.get("item_id")
        item = connection.items.get(item_id) if isinstance(item_id, str) else None

        async def reject() -> None:
            error = service.make_error("Unknown item or invalid audio truncation.", "invalid_conversation_item")
            error.error.event_id = raw.get("event_id")
            await transport.send_events([error])

        if item is None:
            await reject()
            return
        if kind == "conversation.item.retrieve":
            await transport.send_events([RetrievedItemEvent(
                event_id=service._next_event_id(), item=item,
            )])
            return
        index, end_ms = raw.get("content_index"), raw.get("audio_end_ms")
        content = item.get("content") or []
        if (item.get("role") != "assistant" or type(index) is not int
                or index < 0 or index >= len(content)
                or content[index].get("type") not in ("audio", "output_audio")
                or type(end_ms) is not int or end_ms < 0
                or end_ms > connection.audio_ms.get(item_id, 0)):
            await reject()
            return
        service.response.discard_tool_followup_prefetch(session_id)
        ids = connection.history_ids.get(item_id, set())
        chat = config.chat
        with chat._lock:
            chat.buffer = [entry for entry in chat.buffer if entry.id not in ids]
        content[index]["transcript"] = ""
        item["status"] = "incomplete"
        await transport.send_events([ConversationItemTruncatedEvent(
            type="conversation.item.truncated", event_id=service._next_event_id(),
            item_id=item_id, content_index=index, audio_end_ms=end_ms,
        )])

    ResponseHandler.finish_response = finish_response
    websocket_router._dispatch_client_event = dispatch
