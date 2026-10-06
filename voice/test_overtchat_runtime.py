import base64
import asyncio
import hashlib
import hmac
import json
import logging
import unittest
import time

from overtchat_runtime import VoiceTicketMiddleware, _connection, _SessionModelFilter, valid_ticket


def ticket(payload: dict[str, object], secret: str) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).rstrip(b"=")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), encoded, hashlib.sha256).digest()
    ).rstrip(b"=")
    return f"{encoded.decode()}.{signature.decode()}"


class VoiceTicketTests(unittest.TestCase):
    def test_connect_window_is_enforced(self) -> None:
        secret = "voice-secret"
        payload = {
            "version": 1,
            "connectBy": 120,
            "expiresAt": 28_800,
            "userId": "user-1",
            "modelConfigId": "model-1",
            "webSearchEnabled": False,
            "timeZone": "UTC",
        }
        token = ticket(payload, secret)

        self.assertTrue(valid_ticket(token, secret, now=119))
        self.assertFalse(valid_ticket(token, secret, now=121))

    def test_signature_is_enforced(self) -> None:
        payload = {
            "version": 1,
            "connectBy": 120,
            "expiresAt": 28_800,
            "userId": "user-1",
            "modelConfigId": "model-1",
        }

        self.assertFalse(valid_ticket(ticket(payload, "one"), "two", now=10))

    def test_session_model_log_is_redacted(self) -> None:
        record = logging.LogRecord(
            "voice",
            logging.INFO,
            __file__,
            1,
            "Session model set to: %s",
            ("secret-ticket",),
            None,
        )

        self.assertTrue(_SessionModelFilter().filter(record))
        self.assertNotIn("secret-ticket", record.getMessage())


class VoiceMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_socket_never_reaches_the_engine(self):
        sent = []
        async def app(*args):
            self.fail("invalid socket reached the engine")
        async def send(message):
            sent.append(message)
        await VoiceTicketMiddleware(app, "secret")({
            "type": "websocket", "path": "/v1/realtime", "headers": [],
        }, None, send)
        self.assertEqual(sent[0]["code"], 1008)

    async def test_overlapping_sockets_keep_separate_authenticated_context(self):
        entered = 0
        both_entered = asyncio.Event()
        async def app(scope, receive, send):
            nonlocal entered
            connection = _connection.get()
            entered += 1
            if entered == 2:
                both_entered.set()
            await both_entered.wait()
            self.assertIs(_connection.get(), connection)
            self.assertEqual(connection.ticket, scope["expected"])

        async def send(message):
            pass
        middleware = VoiceTicketMiddleware(app, "secret")
        calls = []
        for user in ("first", "second"):
            now = int(time.time())
            token = ticket({"version": 1, "connectBy": now + 120, "expiresAt": now + 600,
                            "userId": user, "modelConfigId": "model"}, "secret")
            scope = {"type": "websocket", "path": "/v1/realtime", "expected": token,
                     "headers": [(b"sec-websocket-protocol", f"realtime, openai-insecure-api-key.{token}".encode())]}
            calls.append(middleware(scope, None, send))
        await asyncio.gather(*calls)
        self.assertIsNone(_connection.get())


if __name__ == "__main__":
    unittest.main()
