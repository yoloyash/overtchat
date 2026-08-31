"""Configure the pinned realtime engine for OvertChat's remote model services."""

from __future__ import annotations

import os
import sys

from overtchat_runtime import install_runtime_hooks


def main() -> None:
    shared_secret = os.getenv("VOICE_SHARED_SECRET", "").strip()
    if not shared_secret:
        raise SystemExit("VOICE_SHARED_SECRET must not be empty")

    arguments = [
        "serve",
        "--host",
        "0.0.0.0",
        "--port",
        "8765",
        "--num_pipelines",
        "1",
        "--log_level",
        "info",
        "--stt",
        "openai",
        "--openai_stt_base_url",
        "http://app:4717/api/internal/voice/v1",
        "--openai_stt_model",
        "parakeet-tdt-0.6b-v3",
        "--openai_stt_api_key",
        shared_secret,
        "--openai_stt_response_format",
        "json",
        "--llm_backend",
        "chat-completions",
        "--responses_api_base_url",
        "http://app:4717/api/internal/voice/v1",
        "--responses_api_api_key",
        shared_secret,
        "--model_name",
        "overtchat",
        "--tts",
        "openai",
        "--openai_tts_base_url",
        "http://app:4717/api/internal/voice/v1",
        "--openai_tts_model",
        "kokoro",
        "--openai_tts_voice",
        "af_heart",
        "--openai_tts_api_key",
        shared_secret,
        "--openai_tts_response_format",
        "pcm",
        "--openai_tts_sample_rate",
        "24000",
        "--smart_turn_model_path",
        "/opt/overtchat/models/smart-turn-v3.2-cpu.onnx",
    ]
    install_runtime_hooks(shared_secret)
    sys.argv = ["speech-to-speech", *arguments]
    from speech_to_speech.cli import main as cli_main

    cli_main()


if __name__ == "__main__":
    main()
