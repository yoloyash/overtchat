# Voice sidecar guidance

- This is OvertChat's optional orchestration image. Keep the Hugging Face
  `speech-to-speech` engine pinned; do not replace its realtime protocol or
  copy its demo UI.
- The browser uses the OpenAI Realtime WebSocket transport from `@openai/agents`
  with a playback interruption override and exchanges mono PCM16 at 24 kHz.
  Played time belongs to the audio worklet, not the network transport.
- Keep this service internal to the Compose network. Browser traffic reaches
  `/v1/realtime` through OvertChat's same-origin `/api/voice/realtime` rewrite;
  never publish the container port in managed installs.
- `VOICE_SHARED_SECRET` is mandatory. Validate the signed ticket carried in
  the WebSocket subprotocol before accepting the socket. The engine also
  binds that ticket to server-owned connection state and passes it as the model
  value to OvertChat's internal LLM bridge. Never store a user's ticket on a
  pooled handler or trust a client-supplied model to authorize a request.
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
  See `docs/development.md#realtime-voice` for the isolated CPU test stack.
