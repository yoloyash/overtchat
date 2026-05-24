# overtchat

A simpler self-hosted alternative to Open WebUI. Bring your own model — Anthropic, Google Gemini, or any OpenAI-compatible endpoint. One `docker compose up` and you're in.

https://github.com/user-attachments/assets/bb1c6b31-97ad-43dc-b39c-743c12d7ae4b

## Why I built overtchat

[Open WebUI](https://github.com/open-webui/open-webui) is an impressive project, but every time I tried to actually live in it something got in the way. The browser tab would peg CPU and balloon past a gig on long replies — the streaming pipeline re-broadcasts the entire growing message body on every token, so a long chat is O(N²) in bytes ([#23733](https://github.com/open-webui/open-webui/issues/23733), still open). Pasting any sizeable chunk of text would freeze the page for seconds ([#12087](https://github.com/open-webui/open-webui/issues/12087), still open). The v0.9 release line shipped a run of migration regressions where you'd `docker pull` and then have to `docker exec` into the container and hand-edit alembic scripts before the app would boot.

And underneath all that, the UI just feels heavy. Settings pages full of toggles for features I'd never use. Web search that wants its own API key. TTS that wants its own setup. A hundred surfaces in front of a single text box.

I wanted a chat app I could open and use. So I wrote one.

## What's different, concretely

- **One process, one SQLite file, one tiny Redis.** A Next.js app, a SQLite file for everything that matters, and a tiny Redis container (~13 MB idle, capped at 64 MB) that exists only so a reload mid-reply doesn't drop your tokens. No Postgres, no Celery, no separate API service. Schema migrations are one Drizzle command on container boot.
- **600 MB Docker image vs Open WebUI's 1.7 GB** (compressed, amd64, pulled from `ghcr.io` on 2026-05-20). About a third the size on disk, fewer layers.
- **No plugin runtime, no pipelines, no functions framework.** Tools are two AI SDK definitions in [`apps/web/lib/tools.ts`](apps/web/lib/tools.ts): `web_search` (SearXNG) and `fetch_url` (Defuddle → markdown). That's the whole extensibility surface.
- **No RAG, no embeddings, no vector DB.** Chat search is SQLite FTS5 + BM25, populated by triggers ([`apps/web/lib/db/search.ts`](apps/web/lib/db/search.ts)). Web search results go straight into context as JSON.
- **One LLM client for everything.** Anthropic, Google Gemini, OpenAI, Groq, OpenRouter, xAI, Mistral, DeepSeek, Together, Ollama, vLLM, llama.cpp — all through [`@ai-sdk/openai-compatible`](apps/web/lib/llm.ts).

If you want every feature in the world — image generation, a code interpreter, knowledge graphs, a plugin marketplace — use Open WebUI or LibreChat. If you want a chat app that opens in under a second and stays out of your way, this is that.

## Quick start

```bash
git clone https://github.com/yoloyash/overtchat
cd overtchat
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Open [http://localhost:4718](http://localhost:4718), sign up, the setup wizard takes you the rest of the way.

**LAN access:** set `BETTER_AUTH_URL=http://<your-lan-ip>:4718` in `.env`, then `docker compose up -d`.
**Internet access:** uncomment the `cloudflared` block in `compose.yml` and paste a tunnel token.

## What's in the box

- Multi-user auth, first signup becomes admin
- Persistent chat history, auto-titled, full-text searchable
- File uploads — images, PDFs, Word, Excel, CSV, source code
- Projects with per-project system prompts
- Web search via bundled SearXNG. No API key.
- Text-to-speech via bundled Kokoro. No setup.
- Speech-to-text via Parakeet TDT v3 (opt-in, CPU or NVIDIA GPU)
- Chat export (JSON / Markdown)

## Speech-to-text (optional)

Off by default — the mic button in the composer is greyed out until you bring up the Parakeet sidecar:

```bash
docker compose --profile stt up -d        # CPU (~670 MB model, ~2 GB RAM)
docker compose --profile stt-gpu up -d    # NVIDIA GPU (requires NVIDIA Container Toolkit)
```

Multilingual (25 languages, auto-detected). All processing stays on your machine. Model downloads on first start (~10 s) and is cached in a Docker volume.

## Privacy

No telemetry, no analytics. No external calls except the LLM endpoint you configure and the bundled SearXNG (which runs on your machine). All data lives in a single SQLite file you can copy, back up, or delete.

## Requirements

- Docker + Docker Compose v2
- ~1 GB RAM free for the app stack (Kokoro TTS pulls ~100 MB on first boot)
- An LLM endpoint (API key or self-hosted)

## Stack

Next.js 16 · Vercel AI SDK v6 · Better Auth · Drizzle + SQLite · Redis (resume buffer) · base-ui · Tailwind · SearXNG · Kokoro TTS

## More

- [docs/deploy.md](docs/deploy.md) — updates, backup, troubleshooting

## License

MIT. Fork it, white-label it, ship it. No branding clauses to negotiate around.
