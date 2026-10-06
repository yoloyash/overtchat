"""Contract regressions run inside the voice image against the pinned engine."""
from importlib.util import find_spec
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from overtchat_runtime import VoiceConnection, _connection, install_runtime_hooks

ENGINE_AVAILABLE = find_spec("speech_to_speech") is not None
if ENGINE_AVAILABLE:
    from speech_to_speech.LLM.base_openai_compatible_language_model import BaseOpenAICompatibleHandler
    from speech_to_speech.LLM.chat import make_assistant_message, make_user_message
    from speech_to_speech.api.openai_realtime import websocket_router
    from speech_to_speech.api.openai_realtime.service import RealtimeService
    from openai.types.realtime import SessionUpdateEvent


@unittest.skipUnless(ENGINE_AVAILABLE, "run in the voice image for the pinned engine")
class PinnedRuntimeTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        # Exercise the real auth/registration/dispatch hooks without inference.
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

    async def test_completed_response_truncation_removes_unheard_context(self):
        connection, service, conn_id, config = self.connection("ticket")
        chat = config.chat
        chat.add_item(make_user_message("Question"))
        chat.add_provisional_generation_items("generation", [make_assistant_message("Unheard answer")])
        # The engine's wire audio ID differs from its internal assistant ID.
        state = service._state(conn_id)
        state.current_response_key = "generation"
        state.current_response_id = "resp_test"
        state.current_item_id = "item_wire"
        state.in_response = True
        state.pending_text_outputs = [{"item_id": "item_wire", "output_index": 0, "parts": ["Unheard answer"]}]
        events = service.finish_response(conn_id)
        for event in events:
            connection.observe(event.model_dump())
        self.assertIn("item_wire", connection.items)
        self.assertTrue(connection.history_ids["item_wire"])
        connection.audio_ms["item_wire"] = 1000
        self.assertEqual(len(chat.to_transformers_chat()), 2)
        sent = []

        async def send_events(events):
            sent.extend(event.model_dump() for event in events)
        transport = SimpleNamespace(send_events=send_events)
        unit = SimpleNamespace(service=service)
        await websocket_router._dispatch_client_event(unit, conn_id, {
            "type": "conversation.item.truncate", "item_id": "item_wire",
            "content_index": 0, "audio_end_ms": 100,
        }, transport)
        self.assertEqual(sent[-1]["type"], "conversation.item.truncated")
        self.assertEqual([item["role"] for item in chat.to_transformers_chat()], ["user"])
        await websocket_router._dispatch_client_event(unit, conn_id, {
            "type": "conversation.item.retrieve", "item_id": "item_wire",
        }, transport)
        self.assertEqual(sent[-1]["item"]["content"][0]["transcript"], "")
        self.assertEqual(sent[-1]["item"]["status"], "incomplete")

    async def test_truncation_rejects_other_items_and_impossible_positions(self):
        connection, service, conn_id, _ = self.connection("ticket")
        connection.items["item_user"] = {"id": "item_user", "role": "user", "content": [{"type": "input_audio"}]}
        connection.items["item_audio"] = {"id": "item_audio", "role": "assistant", "content": [{"type": "audio"}]}
        connection.audio_ms["item_audio"] = 10
        sent = []
        async def send_events(events):
            sent.extend(events)
        for item_id, end_ms in [("item_unknown", 0), ("item_user", 0), ("item_audio", 11), ("item_audio", -1)]:
            await websocket_router._dispatch_client_event(SimpleNamespace(service=service), conn_id, {
                "type": "conversation.item.truncate", "item_id": item_id,
                "content_index": 0, "audio_end_ms": end_ms,
            }, SimpleNamespace(send_events=send_events))
            self.assertEqual(sent[-1].type, "error")


if __name__ == "__main__":
    unittest.main()
