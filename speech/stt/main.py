"""Minimal OpenAI-compatible Parakeet STT sidecar for OvertChat."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

# Limit numeric-library pools before importing ONNX Runtime or NumPy.
for _name in (
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ.setdefault(_name, "1")

import numpy as np
import onnx_asr
import onnxruntime as ort
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("stt")

PUBLIC_MODEL = "parakeet-tdt-0.6b-v3"
MODEL_ALIASES = {PUBLIC_MODEL, "whisper-1"}
SAMPLE_RATE = 16_000
MAX_UPLOAD_BYTES = int(os.getenv("STT_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
FFMPEG_TIMEOUT_SECONDS = float(os.getenv("STT_FFMPEG_TIMEOUT_SECONDS", "180"))
USE_GPU = os.getenv("PARAKEET_USE_GPU", "false").strip().lower() == "true"
GPU_DEVICE_ID = int(os.getenv("PARAKEET_GPU_DEVICE_ID", "0"))
MAX_BATCH_SIZE = int(os.getenv("PARAKEET_MAX_BATCH_SIZE", "4"))
BATCH_WINDOW_SECONDS = (
    float(os.getenv("PARAKEET_BATCH_WINDOW_MS", "4")) / 1000.0
)

if USE_GPU:
    SOURCE_MODEL = "istupakov/parakeet-tdt-0.6b-v3-onnx"
    QUANTIZATION = None
    DEVICE = "cuda"
    PRECISION = "fp32"
    ORT_INTRA_THREADS = 1
else:
    SOURCE_MODEL = "nemo-parakeet-tdt-0.6b-v3"
    QUANTIZATION = "int8"
    DEVICE = "cpu"
    PRECISION = "int8"
    try:
        _logical_cpus = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        _logical_cpus = os.cpu_count() or 1
    ORT_INTRA_THREADS = max(1, _logical_cpus // 2)

state: dict[str, Any] = {"ready": False}


def _session_options() -> ort.SessionOptions:
    options = ort.SessionOptions()
    options.intra_op_num_threads = ORT_INTRA_THREADS
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.add_session_config_entry("session.set_denormal_as_zero", "1")
    return options


def _providers() -> list[Any]:
    if not USE_GPU:
        return ["CPUExecutionProvider"]

    preload = getattr(ort, "preload_dlls", None)
    if preload is None:
        raise RuntimeError("ONNX Runtime cannot preload CUDA/cuDNN libraries")
    preload(cuda=True, cudnn=True, msvc=False)
    available = set(ort.get_available_providers())
    if "CUDAExecutionProvider" not in available:
        raise RuntimeError(
            "CUDAExecutionProvider is unavailable; "
            f"available providers: {sorted(available)}"
        )
    return [
        (
            "CUDAExecutionProvider",
            {
                "device_id": GPU_DEVICE_ID,
                "cudnn_conv_algo_search": "EXHAUSTIVE",
                "cudnn_conv_use_max_workspace": "1",
                "do_copy_in_default_stream": "1",
            },
        )
    ]


def _provider_report(model: Any) -> dict[str, list[str]]:
    report: dict[str, list[str]] = {}
    for prefix, candidate in (("model", model), ("asr", getattr(model, "asr", None))):
        if candidate is None:
            continue
        for attribute in ("_model", "_encoder", "_decoder", "_decoder_joint"):
            session = getattr(candidate, attribute, None)
            get_providers = getattr(session, "get_providers", None)
            if callable(get_providers):
                report[f"{prefix}.{attribute}"] = list(get_providers())
    return report


def _load_model() -> Any:
    providers = _providers()
    log.info(
        "loading %s precision=%s providers=%s",
        SOURCE_MODEL,
        PRECISION,
        providers,
    )
    model = onnx_asr.load_model(
        SOURCE_MODEL,
        quantization=QUANTIZATION,
        providers=providers,
        sess_options=_session_options(),
    )
    report = _provider_report(model)
    log.info("session providers: %s", report)
    if USE_GPU and (
        not report
        or any(
            not providers or providers[0] != "CUDAExecutionProvider"
            for providers in report.values()
        )
    ):
        raise RuntimeError(f"model did not bind every ONNX session to CUDA: {report}")
    return model


def _decode_audio(blob: bytes) -> np.ndarray:
    try:
        process = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "f32le",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "pipe:1",
            ],
            input=blob,
            capture_output=True,
            check=False,
            timeout=FFMPEG_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("audio decode timed out") from exc
    if process.returncode != 0:
        detail = process.stderr.decode("utf-8", "replace").strip()[:500]
        raise ValueError(f"could not decode audio: {detail}")
    audio = np.frombuffer(process.stdout, dtype=np.float32)
    if not audio.size:
        raise ValueError("decoded audio is empty")
    return audio


def _recognize_batch(model: Any, waveforms: list[np.ndarray]) -> list[Any]:
    if len(waveforms) == 1:
        return [model.recognize(waveforms[0])]
    result = model.recognize(waveforms)
    if isinstance(result, (list, tuple)):
        return list(result)
    return list(result)


@dataclass(slots=True)
class _Job:
    waveform: np.ndarray
    future: asyncio.Future[Any]


class BatchWorker:
    """Collect concurrent GPU requests into batches of at most four."""

    def __init__(self, model: Any):
        self.model = model
        self.queue: asyncio.Queue[_Job] = asyncio.Queue(maxsize=64)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ort")
        self.task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self.task = asyncio.create_task(self._run(), name="stt-batch-worker")
        log.info(
            "GPU micro-batching enabled max_batch=%d window=%.1fms",
            MAX_BATCH_SIZE,
            BATCH_WINDOW_SECONDS * 1000,
        )

    async def submit(self, waveform: np.ndarray) -> Any:
        future = asyncio.get_running_loop().create_future()
        await self.queue.put(_Job(waveform, future))
        return await future

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            batch = [await self.queue.get()]
            deadline = time.monotonic() + BATCH_WINDOW_SECONDS
            while len(batch) < MAX_BATCH_SIZE:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    batch.append(await asyncio.wait_for(self.queue.get(), remaining))
                except asyncio.TimeoutError:
                    break
            try:
                results = await loop.run_in_executor(
                    self.executor,
                    _recognize_batch,
                    self.model,
                    [job.waveform for job in batch],
                )
                if len(results) != len(batch):
                    raise RuntimeError("batched inference returned the wrong result count")
                for job, result in zip(batch, results):
                    if not job.future.done():
                        job.future.set_result(result)
            except asyncio.CancelledError:
                for job in batch:
                    if not job.future.done():
                        job.future.set_exception(RuntimeError("STT worker stopped"))
                raise
            except Exception as exc:
                log.exception("batched inference failed")
                for job in batch:
                    if not job.future.done():
                        job.future.set_exception(exc)
            finally:
                for _job in batch:
                    self.queue.task_done()

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        while not self.queue.empty():
            job = self.queue.get_nowait()
            if not job.future.done():
                job.future.set_exception(RuntimeError("STT worker stopped"))
            self.queue.task_done()
        await asyncio.to_thread(self.executor.shutdown, wait=True)


def _result_text(result: Any) -> str:
    return str(getattr(result, "text", result) or "").strip()


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["model"] = await asyncio.to_thread(_load_model)
    state["cpu_lock"] = asyncio.Lock()
    if USE_GPU:
        state["worker"] = BatchWorker(state["model"])
        await state["worker"].start()
    state["ready"] = True
    log.info("model ready")
    try:
        yield
    finally:
        state["ready"] = False
        if worker := state.get("worker"):
            await worker.stop()


app = FastAPI(title="OvertChat STT", lifespan=lifespan)


@app.get("/health")
async def health():
    ready = bool(state["ready"])
    return {
        "status": "healthy" if ready else "starting",
        "ready": ready,
        "models": [PUBLIC_MODEL],
        "loaded": [PUBLIC_MODEL] if ready else [],
        "default_model": PUBLIC_MODEL,
        "backend": {"device": DEVICE, "precision": PRECISION},
    }


@app.get("/healthz")
async def healthz():
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="not ready")
    return {"status": "ok"}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    model: str = Form(PUBLIC_MODEL),
    response_format: str = Form("json"),
):
    if model.strip().lower() not in MODEL_ALIASES:
        raise HTTPException(status_code=400, detail=f"unknown model {model!r}")
    if response_format not in {"json", "text"}:
        raise HTTPException(status_code=400, detail="response_format must be json or text")

    blob = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not blob:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="upload too large")
    try:
        waveform = await asyncio.to_thread(_decode_audio, blob)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if USE_GPU:
        result = await state["worker"].submit(waveform)
    else:
        async with state["cpu_lock"]:
            result = await asyncio.to_thread(state["model"].recognize, waveform)
    if await request.is_disconnected():
        return JSONResponse({"text": ""}, status_code=499)

    text = _result_text(result)
    if response_format == "text":
        return PlainTextResponse(text)
    return JSONResponse({"text": text})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("STT_HOST", "0.0.0.0"),
        port=int(os.getenv("STT_PORT", "5092")),
        access_log=False,
    )
