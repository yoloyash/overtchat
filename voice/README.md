# OvertChat voice image

This directory defines OvertChat's realtime voice orchestration image. It uses
the Hugging Face `speech-to-speech` realtime engine at the exact revision in
the Dockerfile, while Parakeet, the LLM/tool bridge, and Kokoro remain separate
OpenAI-compatible services.

The image intentionally contains CPU-only Torch for Silero VAD, ONNX Runtime
for Smart Turn v3.2, Transformers for Smart Turn feature extraction, and the
small supporting Python runtime. Silero, Smart Turn, and NLTK assets are baked
in so a running container does not download code or models.

Direct upstream components and their pinned revisions are documented in
`THIRD_PARTY_NOTICES.md`. Their license texts, along with OvertChat's license,
are available at `/opt/overtchat/licenses` in the built image. Python wheel
license metadata remains in the corresponding `*.dist-info` directories.

It intentionally does not contain CUDA, Parakeet or Kokoro model weights,
`nano-parakeet`, Qwen TTS, Lingua, spaCy, G2P data, PortAudio, Librosa, or
microphone/speaker clients. Those are either already owned by
other OvertChat services or unused by a browser-to-server deployment.

Torchaudio is present only because current Silero imports its matching CPU
wheel while loading the VAD model; no audio-device or CUDA backend is included.

Build the isolated image context with:

```sh
docker build -t overtchat-voice:dev voice
```

The defaults target the eventual managed Compose service names:

- STT: `http://stt:5092/v1`
- LLM/tools: `http://app:4717/api/internal/voice/v1`
- TTS: `http://kokoro:8880/v1`
- Realtime listener: `0.0.0.0:8765`

All defaults can be changed with the `VOICE_*` variables defined in
`entrypoint.py`. The container is not added to the managed stack until the
authenticated session route and OvertChat LLM/tool bridge exist.
