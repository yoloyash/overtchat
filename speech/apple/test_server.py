"""Contract and worker tests; no model downloads or Apple hardware required."""
import asyncio
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
import server


class FakeModels:
    threads = []

    def __init__(self, enabled):
        self.threads.append(threading.get_ident())
        self.voices = {"af_heart": None}

    def transcribe(self, waveform, stopped=None):
        self.threads.append(threading.get_ident())
        return "A real transcript"

    def speech(self, text, voice, speed):
        self.threads.append(threading.get_ident())
        yield b"\x01\x00" * 240
        yield b"\x02\x00" * 240


class SpeechTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ffmpeg = patch.object(server, "ffmpeg", return_value="/bin/true")
        self.ffmpeg.start()
        self.addCleanup(self.ffmpeg.stop)
        FakeModels.threads = []

    def client(self, capabilities=None):
        config = {"capabilities": capabilities or ["stt", "tts"], "token": "test-token",
                  "revision": "test", "cache_directory": self.directory.name}
        client = TestClient(server.create_app(config, FakeModels))
        client.headers["Authorization"] = "Bearer test-token"
        return client

    def test_private_readiness_and_disabled_capability(self):
        with self.client(["stt"]) as client:
            self.assertTrue(client.get("/healthz").json()["ready"])
            self.assertEqual(client.get("/healthz", headers={"Authorization": "Bearer wrong"}).status_code, 401)
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "Hello"}).status_code, 503)

    def test_transcription_normalizes_formats_and_uses_model_thread(self):
        with self.client() as client, patch.object(server, "decode", return_value=np.zeros(10)):
            for fmt in ["json", "text"]:
                response = client.post("/v1/audio/transcriptions", files={"file": ("mobile.m4a", b"audio", "audio/mp4")}, data={"response_format": fmt})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["text"] if fmt == "json" else response.text, "A real transcript")
        self.assertEqual(len(set(FakeModels.threads)), 1)
        self.assertNotEqual(FakeModels.threads[0], threading.get_ident())

    def test_invalid_requests_are_rejected_before_inference(self):
        with self.client() as client:
            for data in [{"model": "arbitrary/download"}, {"response_format": "unknown"}]:
                self.assertEqual(client.post("/v1/audio/transcriptions", files={"file": ("x.wav", b"x")}, data=data).status_code, 400)
            self.assertEqual(client.post("/v1/audio/transcriptions", files={"file": ("x.wav", b"")}).status_code, 400)
            with patch.object(server, "decode", side_effect=ValueError("Could not decode audio")):
                self.assertEqual(client.post("/v1/audio/transcriptions", files={"file": ("x.wav", b"bad")}).status_code, 400)
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "test", "voice": "../../other.pt"}).status_code, 400)
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "test", "model": "other"}).status_code, 400)
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "x" * 5001}).status_code, 422)

    def test_pcm_and_wav_preserve_audio_chunks(self):
        with self.client() as client:
            pcm = client.post("/v1/audio/speech", json={"input": "Hello", "response_format": "pcm"})
            wav = client.post("/v1/audio/speech", json={"input": "Hello", "response_format": "wav"})
            self.assertEqual(pcm.content, b"\x01\x00" * 240 + b"\x02\x00" * 240)
            self.assertEqual(wav.content[:4], b"RIFF")
            self.assertEqual(wav.content[44:], pcm.content)
        self.assertEqual(len(set(FakeModels.threads)), 1)

    def test_queue_limit_is_held_until_cancelled_work_really_finishes(self):
        async def run():
            worker = server.Worker()
            gate = threading.Event()
            try:
                futures = []
                for _ in range(8):
                    worker.reserve()
                    futures.append(worker.submit(gate.wait, 2))
                with self.assertRaises(server.HTTPException):
                    worker.reserve()
                # Awaiter cancellation must not cancel the worker's admission accounting.
                async def await_result():
                    await asyncio.shield(futures[0])
                task = asyncio.create_task(await_result())
                await asyncio.sleep(0)
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                self.assertEqual(worker.pending, 8)
                gate.set()
                await asyncio.gather(*futures)
                self.assertEqual(worker.pending, 0)
            finally:
                gate.set()
                worker.executor.shutdown()
        asyncio.run(run())


class CodecTests(unittest.TestCase):
    def test_streaming_codecs_preserve_duration_across_chunks(self):
        pcm = (np.sin(np.arange(24000) * 2 * np.pi * 440 / 24000) * 16000).astype("<i2").tobytes()
        for fmt in ["mp3", "opus", "aac", "flac"]:
            with self.subTest(format=fmt):
                encoder = server.AudioEncoder(fmt)
                try:
                    parts = [encoder.write(pcm) for _ in range(20)]
                    self.assertTrue(any(parts), "audio must stream before finalization")
                    blob = b"".join(parts) + encoder.finish()
                finally:
                    encoder.close()
                decoded = server.decode(blob)
                self.assertAlmostEqual(len(decoded) / 16000, 20, delta=0.15)

    def test_transcription_uses_upstream_chunking_and_cancellation(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        models = server.Models.__new__(server.Models)
        models.stt = SimpleNamespace(transcribe=Mock(return_value=SimpleNamespace(text=" transcript ")))
        stop = threading.Event()
        self.assertEqual(models.transcribe(np.zeros(16000), stop), "transcript")
        options = models.stt.transcribe.call_args.kwargs
        self.assertEqual(options["chunk_duration"], 120)
        self.assertEqual(options["overlap_duration"], 15)
        stop.set()
        with self.assertRaises(InterruptedError):
            options["chunk_callback"](120, 240)

    def test_mobile_m4a_with_trailing_index_is_decoded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "recording.m4a"
            subprocess.run([server.ffmpeg(), "-v", "error", "-f", "lavfi", "-i",
                            "sine=frequency=440:duration=1", "-c:a", "aac", str(path)], check=True)
            waveform = server.decode(path.read_bytes())
            self.assertGreaterEqual(len(waveform), 16000)
            self.assertLess(len(waveform), 18000)
            self.assertGreater(np.max(np.abs(waveform)), 0.01)


if __name__ == "__main__":
    unittest.main()
