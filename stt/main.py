"""Parakeet TDT v3 STT service for overtchat.

Exposes an OpenAI-compatible /v1/audio/transcriptions endpoint backed by the
istupakov/onnx-asr Parakeet TDT 0.6B v3 model. Any ffmpeg-decodable input is
accepted; ffmpeg normalizes it to 16 kHz mono float32 PCM in-process.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from contextlib import asynccontextmanager

import numpy as np
import onnx_asr
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stt")

MODEL_NAME = os.environ.get("STT_MODEL", "nemo-parakeet-tdt-0.6b-v3")
QUANTIZATION = os.environ.get("STT_QUANTIZATION", "int8") or None
MAX_UPLOAD_BYTES = int(os.environ.get("STT_MAX_UPLOAD_BYTES", 50 * 1024 * 1024))
SAMPLE_RATE = 16_000

state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("loading model %s (quantization=%s)", MODEL_NAME, QUANTIZATION)
    state["model"] = onnx_asr.load_model(MODEL_NAME, quantization=QUANTIZATION)
    state["lock"] = asyncio.Lock()
    log.info("model ready")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok" if "model" in state else "loading", "model": MODEL_NAME}


def _decode_to_pcm(blob: bytes) -> np.ndarray:
    """Run ffmpeg to convert any audio container to 16 kHz mono float32 PCM."""
    proc = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE),
            "pipe:1",
        ],
        input=blob, capture_output=True, check=False,
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"could not decode audio: {proc.stderr.decode('utf-8', 'replace').strip()[:500]}",
        )
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    if audio.size == 0:
        raise HTTPException(status_code=400, detail="decoded audio is empty")
    return audio


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
):
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="upload too large")

    audio = await asyncio.to_thread(_decode_to_pcm, blob)

    async with state["lock"]:
        text = await asyncio.to_thread(
            state["model"].recognize, audio, sample_rate=SAMPLE_RATE
        )

    text = (text or "").strip()
    if response_format == "text":
        return PlainTextResponse(text)
    return JSONResponse({"text": text})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("STT_PORT", 5092)))
