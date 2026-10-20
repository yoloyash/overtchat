"""OvertChat's host-native Apple speech service. Inference stays in upstream libraries."""
from __future__ import annotations

import asyncio
import json
import io
import logging
import os
from pathlib import Path
import queue
import secrets
import shutil
import struct
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

# Set before importing either runtime, including on the inference thread.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

TTS_MODEL = "kokoro"
STT_MODEL = "parakeet-tdt-0.6b-v3"
KOKORO_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
PARAKEET_REVISION = "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15"
MAX_UPLOAD = 25 * 1024 * 1024
MAX_AUDIO_SECONDS = 600
FORMATS = {"pcm": "audio/pcm", "wav": "audio/wav", "mp3": "audio/mpeg",
           "flac": "audio/flac", "opus": "audio/ogg", "aac": "audio/aac"}
log = logging.getLogger("overtchat.speech")


def ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def decode(blob: bytes) -> np.ndarray:
    """Decode the content, never infer codecs from an uploaded filename."""
    try:
        # M4A containers often keep their index at the end and require seeking.
        with tempfile.TemporaryDirectory(prefix="overtchat-decode-") as directory:
            source = Path(directory) / "upload"
            source.write_bytes(blob)
            result = subprocess.run(
                [ffmpeg(), "-nostdin", "-v", "error", "-i", str(source), "-t",
                 str(MAX_AUDIO_SECONDS + 1), "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"],
                capture_output=True, timeout=30,
            )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Audio decoding timed out") from exc
    if result.returncode:
        raise ValueError("Could not decode audio")
    audio = np.frombuffer(result.stdout, dtype="<f4")
    if not audio.size:
        raise ValueError("Audio is empty")
    if audio.size > MAX_AUDIO_SECONDS * 16000:
        raise ValueError("Audio exceeds ten minutes")
    return audio


class AudioBuffer(io.RawIOBase):
    """A non-seekable output, so muxers produce streaming headers and trailers."""
    def __init__(self):
        self.data = bytearray()

    def writable(self):
        return True

    def write(self, data):
        self.data.extend(data)
        return len(data)


class AudioEncoder:
    """One codec context per response, as in Kokoro-FastAPI's streaming writer."""
    def __init__(self, fmt: str):
        import av
        self.av = av
        self.buffer = AudioBuffer()
        self.samples = 0
        container = "ogg" if fmt == "opus" else "adts" if fmt == "aac" else fmt
        codec = {"mp3": "libmp3lame", "flac": "flac", "opus": "libopus", "aac": "aac"}[fmt]
        self.output = av.open(self.buffer, mode="w", format=container,
                              options={"write_xing": "0", "id3v2_version": "0"} if fmt == "mp3" else {})
        self.stream = self.output.add_stream(codec, rate=24000, layout="mono")
        if fmt in {"mp3", "opus", "aac"}:
            self.stream.bit_rate = 128000

    def drain(self) -> bytes:
        data = bytes(self.buffer.data)
        self.buffer.data.clear()
        return data

    def write(self, pcm: bytes) -> bytes:
        frame = self.av.AudioFrame.from_ndarray(np.frombuffer(pcm, dtype="<i2").reshape(1, -1),
                                                format="s16", layout="mono")
        frame.sample_rate = 24000
        frame.pts = self.samples
        self.samples += frame.samples
        for packet in self.stream.encode(frame):
            self.output.mux(packet)
        return self.drain()

    def finish(self) -> bytes:
        for packet in self.stream.encode(None):
            self.output.mux(packet)
        # Container trailers (notably Ogg's final page) are emitted on close.
        self.output.close()
        return self.drain()

    def close(self):
        self.output.close()
        self.buffer.close()


def wav_header() -> bytes:
    # Streaming WAV has an unknown length until synthesis finishes.
    return struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 0xFFFFFFFF, b"WAVE", b"fmt ",
                       16, 1, 1, 24000, 48000, 2, 16, b"data", 0xFFFFFFFF)


class Models:
    """Construct, warm, and use all runtime state on the same worker thread."""
    def __init__(self, enabled: list[str]):
        from huggingface_hub import snapshot_download
        self.tts = self.stt = None
        self.pipelines = {}
        self.voices: dict[str, Path] = {}
        if "tts" in enabled:
            import torch
            from kokoro import KModel
            import espeakng_loader
            from phonemizer.backend.espeak.wrapper import EspeakWrapper
            # eSpeak's native path buffer cannot hold deeply nested managed venv paths.
            # Keep real data at a short path; its wrapper resolves symlinks.
            self.phonemes = tempfile.TemporaryDirectory(prefix="oc-speech-")
            shutil.copytree(espeakng_loader.get_data_path(), self.phonemes.name, dirs_exist_ok=True)
            EspeakWrapper.set_data_path(self.phonemes.name)
            if not torch.backends.mps.is_available():
                raise RuntimeError("Apple MPS is unavailable")
            root = Path(snapshot_download("hexgrad/Kokoro-82M", revision=KOKORO_REVISION,
                                         allow_patterns=["config.json", "kokoro-v1_0.pth", "voices/*.pt"]))
            self.tts = KModel(repo_id="hexgrad/Kokoro-82M", config=str(root / "config.json"),
                              model=str(root / "kokoro-v1_0.pth"), disable_complex=True).to("mps").eval()
            self.voices = {p.stem: p for p in (root / "voices").glob("*.pt")}
            list(self.speech("Speech is ready.", "af_heart", 1.0))
        if "stt" in enabled:
            import mlx.core as mx
            from parakeet_mlx import from_pretrained
            if not mx.metal.is_available():
                raise RuntimeError("Apple Metal is unavailable")
            root = snapshot_download("mlx-community/parakeet-tdt-0.6b-v3", revision=PARAKEET_REVISION,
                                     allow_patterns=["config.json", "model.safetensors"])
            self.stt = from_pretrained(root)
            self.transcribe(np.zeros(16000, dtype=np.float32))

    def speech(self, text: str, voice: str, speed: float):
        import torch
        from kokoro import KPipeline
        if voice not in self.voices:
            raise ValueError("Unknown Kokoro voice")
        language = voice[0]
        if language not in self.pipelines:
            self.pipelines[language] = KPipeline(lang_code=language, repo_id="hexgrad/Kokoro-82M", model=self.tts)
        pipeline = self.pipelines[language]
        # Resolve voice packs from the pinned snapshot, not upstream's current main.
        if voice not in pipeline.voices:
            pipeline.voices[voice] = torch.load(self.voices[voice], weights_only=True)
        with torch.inference_mode():
            for result in pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+|(?<=[.!?])\s+"):
                if result.audio is not None:
                    audio = result.audio.detach().cpu().numpy()
                    yield (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()

    def transcribe(self, waveform: np.ndarray, stopped: threading.Event | None = None) -> str:
        # Feed the model a WAV with known encoding. No lossy intermediate re-encode.
        import wave
        with tempfile.TemporaryDirectory(prefix="overtchat-stt-") as directory:
            path = Path(directory) / "audio.wav"
            with wave.open(str(path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes((np.clip(waveform, -1, 1) * 32767).astype("<i2").tobytes())
            def check_cancelled(*_):
                if stopped is not None and stopped.is_set():
                    raise InterruptedError("Transcription cancelled")
            check_cancelled()
            return self.stt.transcribe(str(path), chunk_duration=120,
                                       overlap_duration=15, chunk_callback=check_cancelled).text.strip()


class Worker:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="apple-speech")
        self.models = None
        self.pending = 0

    def reserve(self):
        if self.pending >= 8:
            raise HTTPException(503, "Speech is busy; retry shortly")
        self.pending += 1

    def submit(self, function, *args):
        future = asyncio.get_running_loop().run_in_executor(self.executor, function, *args)
        # Shield callers so disconnects cannot release the admission slot while work is running.
        future.add_done_callback(lambda _: setattr(self, "pending", self.pending - 1))
        return future


class Speech(BaseModel):
    model: str = TTS_MODEL
    input: str = Field(min_length=1, max_length=5000)
    voice: str = "af_heart"
    response_format: str = "mp3"
    speed: float = Field(default=1, ge=0.25, le=4)
    stream: bool = True


def create_app(config: dict, model_factory=Models) -> FastAPI:
    enabled = config["capabilities"]
    token = config["token"]
    if not token or not enabled or set(enabled) - {"tts", "stt"}:
        raise ValueError("Speech requires a token and selected capabilities")
    worker = Worker()
    ready = False

    @asynccontextmanager
    async def lifespan(app):
        nonlocal ready
        try:
            # Parakeet's library invokes ffmpeg by name. Use our packaged executable.
            binary_dir = Path(config["cache_directory"]) / "bin"
            binary_dir.mkdir(parents=True, exist_ok=True)
            executable = binary_dir / "ffmpeg"
            executable.unlink(missing_ok=True)
            executable.symlink_to(ffmpeg())
            os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ.get("PATH", "")
            worker.models = await asyncio.get_running_loop().run_in_executor(worker.executor, model_factory, enabled)
            ready = True
            yield
        finally:
            ready = False
            await asyncio.to_thread(worker.executor.shutdown, wait=True, cancel_futures=True)

    app = FastAPI(title="OvertChat Apple Speech", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        if not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"error": "invalid content length"}, status_code=400)
        if length > MAX_UPLOAD + 65536:
            return JSONResponse({"error": "upload too large"}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    @app.get("/healthz")
    async def health():
        return JSONResponse({"name": "overtchat-speech", "ready": ready,
                             "revision": config["revision"], "capabilities": enabled,
                             "backend": "apple"}, status_code=200 if ready else 503)

    @app.post("/v1/audio/transcriptions")
    async def transcription(request: Request, file: UploadFile = File(...),
                            model: str = Form(STT_MODEL), response_format: str = Form("json")):
        if "stt" not in enabled:
            raise HTTPException(503, "STT is disabled")
        if model not in {STT_MODEL, "whisper-1"} or response_format not in {"json", "text"}:
            raise HTTPException(400, "Unsupported model or response format")
        blob = await file.read(MAX_UPLOAD + 1)
        await file.close()
        if len(blob) > MAX_UPLOAD:
            raise HTTPException(413, "Upload too large")
        if not blob:
            raise HTTPException(400, "Empty audio")
        worker.reserve()
        stopped = threading.Event()

        def run():
            if stopped.is_set():
                return ""
            waveform = decode(blob)
            return "" if stopped.is_set() else worker.models.transcribe(waveform, stopped)

        future = worker.submit(run)
        try:
            while not future.done():
                if await request.is_disconnected():
                    stopped.set()
                    return JSONResponse({"error": "disconnected"}, status_code=499)
                await asyncio.sleep(0.05)
            text = await asyncio.shield(future)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        finally:
            stopped.set()
            future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        return PlainTextResponse(text) if response_format == "text" else JSONResponse({"text": text})

    @app.post("/v1/audio/speech")
    async def speech(body: Speech):
        if "tts" not in enabled:
            raise HTTPException(503, "TTS is disabled")
        if body.model != TTS_MODEL or body.response_format not in FORMATS:
            raise HTTPException(400, "Unsupported model or response format")
        if not body.input.strip() or body.voice not in worker.models.voices:
            raise HTTPException(400, "Empty text or unknown voice")
        worker.reserve()
        stopped = threading.Event()
        chunks = queue.Queue(maxsize=4)

        def emit(value):
            while not stopped.is_set():
                try:
                    chunks.put(value, timeout=0.1)
                    return
                except queue.Full:
                    continue

        def run():
            encoder = None
            try:
                fmt = body.response_format
                if fmt not in {"pcm", "wav"}:
                    encoder = AudioEncoder(fmt)
                for pcm in worker.models.speech(body.input, body.voice, body.speed):
                    if stopped.is_set():
                        break
                    data = encoder.write(pcm) if encoder else pcm
                    if data:
                        emit(data)
                if encoder and not stopped.is_set():
                    emit(encoder.finish())
            except Exception as exc:
                emit(exc)
            finally:
                try:
                    if encoder:
                        encoder.close()
                except Exception as exc:
                    emit(exc)
                finally:
                    emit(None)

        future = worker.submit(run)

        async def stream():
            try:
                if body.response_format == "wav":
                    yield wav_header()
                while True:
                    try:
                        chunk = chunks.get_nowait()
                    except queue.Empty:
                        await asyncio.sleep(0.01)
                        continue
                    if chunk is None:
                        break
                    if isinstance(chunk, Exception):
                        raise chunk
                    yield chunk
            finally:
                stopped.set()
                # Observe failures; the inference slot remains held until the worker exits.
                future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)

        return StreamingResponse(stream(), media_type=FORMATS[body.response_format])

    return app


if __name__ == "__main__":
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    os.environ["HF_HOME"] = str(Path(config["cache_directory"]) / "models")
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(config), host="127.0.0.1", port=config["port"], access_log=False)
