# overtchat

A simpler self-hosted alternative to Open WebUI. Bring your own OpenAI-compatible endpoint. One `docker compose up` and you're in.

![overtchat](public/screenshot.png)

## Why I built overtchat

[Open WebUI](https://github.com/open-webui/open-webui) is an impressive project, but every time I tried to actually live in it something got in the way. Five-to-twenty-second pauses before the first token. Long-chat tabs eating multiple gigs of RAM and going janky on scroll. Updates that break a plugin and ask for migration work before the chat will load.

And underneath all that, the UI just feels heavy. Settings pages full of toggles for features I'd never use. Web search that wants its own API key. TTS that wants its own setup. A hundred surfaces in front of a single text box.

I wanted a chat app I could open and use. So I wrote one.

overtchat is one Next.js app, one SQLite file, one compose file. SearXNG and Kokoro TTS are pre-wired in the same compose — no extra API keys, no extra setup. No RAG, no plugins, no migration steps. The settings page is short on purpose.

If you want every feature in the world, use Open WebUI. If you want a chat app that opens fast and stays out of your way, this is that.

## Quick start

```bash
git clone https://github.com/yoloyash/overtchat
cd overtchat
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Open [http://localhost:4718](http://localhost:4718). First signup becomes admin. Go to **Settings → Models** and point it at your LLM:

- **Ollama / vLLM / llama.cpp on the same host:** `http://host.docker.internal:<port>/v1`
- **OpenAI / Groq / any public provider:** the provider's base URL + API key

Hit "Test connection" to populate the model list, pick one, save.

To open it up to other devices on your LAN, set `BETTER_AUTH_URL` in `.env` to your host's LAN IP (e.g. `http://192.168.1.50:4718`) and `docker compose up -d`. To expose it to the internet, the bundled compose file has a commented-out `cloudflared` service — paste a tunnel token and uncomment.

## What's in the box

- Multi-user auth, first signup becomes admin
- Persistent chat history, auto-titled, full-text searchable
- File uploads — images, PDFs, Word, Excel, CSV, source code
- Projects with per-project system prompts
- Reasoning models (DeepSeek, Qwen3, …) render `<think>` blocks natively
- Web search via bundled SearXNG. No API key.
- Text-to-speech via bundled Kokoro. No setup.
- Speech-to-text via Parakeet TDT v3 (opt-in, CPU or NVIDIA GPU)
- Chat export (JSON / Markdown)
- No RAG, no embeddings, no vector DB. Search results go straight into context.

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
- An OpenAI-compatible LLM endpoint (local or remote)

## Stack

Next.js 16 · Vercel AI SDK v6 · Better Auth · Drizzle + SQLite · base-ui · Tailwind · SearXNG · Kokoro TTS

## More

- [docs/deploy.md](docs/deploy.md) — updates, backup, troubleshooting

## License

MIT
