# Voice sidecar guidance

- This is OvertChat's optional orchestration image. Keep the Hugging Face
  `speech-to-speech` engine pinned; do not replace its realtime protocol or
  copy its demo UI.
- The browser uses the stock OpenAI Realtime WebSocket transport from
  `@openai/agents` and exchanges mono PCM16 audio at 24 kHz.
- Keep this service internal to the Compose network. Browser traffic reaches
  `/v1/realtime` through OvertChat's same-origin `/api/voice/realtime` rewrite;
  never publish the container port in managed installs.
- `VOICE_SHARED_SECRET` is mandatory. Validate the signed ticket carried in
  the WebSocket subprotocol before accepting the socket. The engine also
  passes that ticket as its model value to OvertChat's internal LLM bridge.
  Enforce the short `connectBy` window at the socket and the longer
  `expiresAt` window at the model bridge. Never log tickets or transcripts.
- Parakeet, Kokoro, and the selected text model remain separate services. The
  sidecar reaches all three through authenticated internal app endpoints so
  provider credentials stay in OvertChat. This image contains CPU-only Torch
  for Silero plus baked Smart Turn, Silero, and NLTK assets; it has no CUDA or
  speech-model weights.
- When changing upstream revisions or dependencies, update
  `THIRD_PARTY_NOTICES.md`, bundled license texts, and OCI license metadata.
- Validate changes with an image build, `/v1/pool` health check, rejected
  invalid ticket, and an end-to-end realtime session through the app origin.
