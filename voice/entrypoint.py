"""Configure the pinned realtime engine for OvertChat's remote model services."""

from __future__ import annotations

import os
import sys

from overtchat_runtime import install_runtime_hooks


def env(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    if not value:
        raise SystemExit(f"{name} must not be empty")
    return value


def optional_arg(command: list[str], option: str, name: str) -> None:
    value = os.getenv(name)
    if value is not None and value.strip():
        command.extend((option, value.strip()))


def enabled(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise SystemExit(f"{name} must be true or false")


def main() -> None:
    shared_secret = env("VOICE_SHARED_SECRET", "")
    command = [
        sys.executable,
        "-m",
        "speech_to_speech.cli",
        "serve",
        "--host",
        env("VOICE_HOST", "0.0.0.0"),
        "--port",
        env("VOICE_PORT", "8765"),
        "--num_pipelines",
        env("VOICE_NUM_PIPELINES", "1"),
        "--log_level",
        env("VOICE_LOG_LEVEL", "info"),
        "--stt",
        "openai",
        "--openai_stt_base_url",
        env("VOICE_STT_BASE_URL", "http://app:4717/api/internal/voice/v1"),
        "--openai_stt_model",
        env("VOICE_STT_MODEL", "parakeet-tdt-0.6b-v3"),
        "--openai_stt_api_key",
        shared_secret,
        "--openai_stt_response_format",
        "json",
        "--llm_backend",
        "chat-completions",
        "--responses_api_base_url",
        env("VOICE_LLM_BASE_URL", "http://app:4717/api/internal/voice/v1"),
        "--responses_api_api_key",
        shared_secret,
        "--model_name",
        env("VOICE_LLM_MODEL", "overtchat"),
        "--tts",
        "openai",
        "--openai_tts_base_url",
        env("VOICE_TTS_BASE_URL", "http://app:4717/api/internal/voice/v1"),
        "--openai_tts_model",
        env("VOICE_TTS_MODEL", "kokoro"),
        "--openai_tts_voice",
        env("VOICE_TTS_VOICE", "af_heart"),
        "--openai_tts_api_key",
        shared_secret,
        "--openai_tts_response_format",
        "pcm",
        "--openai_tts_sample_rate",
        "24000",
        "--smart_turn_model_path",
        env(
            "VOICE_SMART_TURN_MODEL",
            "/opt/overtchat/models/smart-turn-v3.2-cpu.onnx",
        ),
    ]

    configurable_values = (
        ("--live_transcription_update_interval", "VOICE_TRANSCRIPT_INTERVAL"),
        ("--smart_turn_threshold", "VOICE_SMART_TURN_THRESHOLD"),
        ("--smart_turn_max_wait_ms", "VOICE_SMART_TURN_MAX_WAIT_MS"),
        ("--smart_turn_incomplete_delay_ms", "VOICE_SMART_TURN_INCOMPLETE_DELAY_MS"),
        ("--smart_turn_cpu_count", "VOICE_SMART_TURN_CPU_COUNT"),
        ("--thresh", "VOICE_VAD_THRESHOLD"),
    )
    for option, name in configurable_values:
        optional_arg(command, option, name)

    if not enabled("VOICE_LIVE_TRANSCRIPTION", True):
        command.append("--no_enable_live_transcription")
    if not enabled("VOICE_SMART_TURN", True):
        command.append("--no_smart_turn")
    if enabled("VOICE_LOG_TRANSCRIPTS", False):
        command.append("--log_transcripts")

    command.extend(sys.argv[1:])
    install_runtime_hooks(shared_secret)
    sys.argv = ["speech-to-speech", *command[3:]]
    from speech_to_speech.cli import main as cli_main

    cli_main()


if __name__ == "__main__":
    main()
