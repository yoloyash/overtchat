import base64
import hashlib
import hmac
import json
import logging
import unittest

from overtchat_runtime import _SessionModelFilter, valid_ticket


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


if __name__ == "__main__":
    unittest.main()
