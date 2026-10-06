"""Contract regressions run inside the voice image against the pinned engine."""
from importlib.util import find_spec
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from overtchat_runtime import VoiceConnection, _connection, install_runtime_hooks

ENGINE_AVAILABLE = find_spec("speech_to_speech") is not None
if ENGINE_AVAILABLE:
    from speech_to_speech.LLM.base_openai_compatible_language_model import BaseOpenAICompatibleHandler
    from speech_to_speech.api.openai_realtime.service import RealtimeService
    from openai.types.realtime import SessionUpdateEvent


@unittest.skipUnless(ENGINE_AVAILABLE, "run in the voice image for the pinned engine")
class PinnedRuntimeTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        # Exercise the real auth/registration hooks without inference.
        def process(handler, request):
            yield handler.model_name
        with patch.object(BaseOpenAICompatibleHandler, "process", process):
            install_runtime_hooks("test-secret")
            cls.process = staticmethod(BaseOpenAICompatibleHandler.process)

    def connection(self, ticket):
        connection = VoiceConnection(ticket)
        service = RealtimeService()
        token = _connection.set(connection)
        try:
            conn_id = service.register()
        finally:
            _connection.reset(token)
        config = service._state(conn_id).runtime_config
        return connection, service, conn_id, config

    def test_reused_handler_never_inherits_another_connections_ticket(self):
        handler = SimpleNamespace(model_name="overtchat")
        _, _, _, first = self.connection("first-ticket")
        _, _, _, second = self.connection("second-ticket")
        first.session.model = "browser-controlled"
        second.session.model = None
        self.assertEqual(list(self.process(handler, SimpleNamespace(runtime_config=first))), ["first-ticket"])
        self.assertEqual(list(self.process(handler, SimpleNamespace(runtime_config=second))), ["second-ticket"])
        self.assertEqual(handler.model_name, "overtchat")
        with self.assertRaisesRegex(RuntimeError, "authenticated connection"):
            list(self.process(handler, SimpleNamespace(runtime_config=SimpleNamespace())))

    def test_session_model_cannot_change_authorization(self):
        _, service, conn_id, config = self.connection("first-ticket")
        update = SessionUpdateEvent(type="session.update", session={"type": "realtime", "model": "second-ticket"})
        self.assertEqual(service.handle_session_update(conn_id, update).error.type, "invalid_session_model")
        self.assertEqual(config.session.model, "first-ticket")
        update = SessionUpdateEvent(type="session.update", session={"type": "realtime", "instructions": "Hi"})
        self.assertIsNone(service.handle_session_update(conn_id, update))
        self.assertEqual(config.session.model, "first-ticket")
        with self.assertRaisesRegex(RuntimeError, "authenticated connection"):
            RealtimeService().register()


if __name__ == "__main__":
    unittest.main()
