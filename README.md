<p align="center">
  <img src=".github/assets/banner.png" alt="overtchat banner" width="600" />
</p>

<p align="center">
  A lightweight self-hosted chat client that "just works". One <code>docker compose up</code> and you're in.
</p>

<p align="center">
  <a href="https://yoloyash.github.io/overtchat/"><img src="https://img.shields.io/badge/Website-overtchat-0D9488" alt="Project website" valign="middle"></a>&nbsp; • &nbsp;
  <a href="docs/android-testing.md"><img src="https://img.shields.io/badge/Android-Google_Play-22C55E?logo=googleplay&logoColor=white" alt="Android on Google Play" valign="middle"></a>&nbsp; • &nbsp;
  <a href="https://yoloyash.github.io/overtchat/privacy/"><img src="https://img.shields.io/badge/Privacy-No_Usage_Analytics-teal?color=0D9488" alt="Privacy Policy" valign="middle"></a>&nbsp; • &nbsp;
  <a href=".github/actions/repo-tokens/README.md"><img src=".github/badges/tokens.svg" alt="source tokens" valign="middle"></a>
</p>

https://github.com/user-attachments/assets/8d135eac-ae55-40eb-934c-e0d88395bb5b

## Why I built overtchat

[Open WebUI](https://github.com/open-webui/open-webui) is an impressive project, but every time I tried to actually live in it something got in the way. The browser tab would peg CPU and balloon past a gig on long replies — the streaming pipeline re-broadcasts the entire growing message body on every token, so a long chat is O(N²) in bytes ([#23733](https://github.com/open-webui/open-webui/issues/23733), still open). Pasting any sizeable chunk of text would freeze the page for seconds ([#12087](https://github.com/open-webui/open-webui/issues/12087), still open). The v0.9 release line shipped a run of migration regressions where you'd `docker pull` and then have to `docker exec` into the container and hand-edit alembic scripts before the app would boot.

And underneath all that, the UI just feels heavy. Settings pages full of toggles for features I'd never use. Web search that wants its own API key. TTS that wants its own setup. A hundred surfaces in front of a single text box.

I wanted a chat app I could open and use. So I wrote one.

## What's different, concretely

- **One process, one SQLite file, one tiny Redis.** A Next.js app, a SQLite file for everything that matters, and a tiny Redis container (~13 MB idle, capped at 64 MB) that exists only so a reload mid-reply doesn't drop your tokens. No Postgres, no Celery, no separate API service. Schema migrations are one Drizzle command on container boot.
- **600 MB Docker image vs Open WebUI's 1.7 GB** (compressed, amd64, pulled from `ghcr.io` on 2026-05-20). About a third the size on disk, fewer layers.
- **No plugin runtime, no pipelines, no functions framework.** Tools are two AI SDK definitions in [`apps/web/lib/tools.ts`](apps/web/lib/tools.ts): `web_search` (SearXNG) and `fetch_url` (Defuddle → markdown). That's the whole extensibility surface.
- **No RAG, no embeddings, no vector DB.** Chat search is SQLite FTS5 + BM25, populated by triggers ([`apps/web/lib/db/search.ts`](apps/web/lib/db/search.ts)). Web search results go straight into context as JSON.
- **Provider-aware without a plugin runtime.** OpenAI, Anthropic, Google Gemini, and Amazon Bedrock use their native API formats through a small registry; custom endpoints explicitly choose Chat Completions, Responses, or Messages. Provider details stay out of the chat pipeline.

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

- **LAN access:** set `BETTER_AUTH_URL=http://<your-lan-ip>:4718` in `.env`, then `docker compose up -d`.
- **Internet access:** uncomment the `cloudflared` block in `compose.yml` and paste a tunnel token.

Already run SearXNG or Kokoro elsewhere? You can point overtchat at them; see [deploy docs](docs/deploy.md#reusing-sidecars).

## Mobile

overtchat now ships as a native Android app — same chat surface, same model picker, same uploads, voice, and web search you have on web.

It's a thin client: **bring your own server**. On first launch, enter the URL of an overtchat instance you control. Chats and files live there, not in the app.

- **Android:** Install through [Google Play](docs/android-testing.md).
- **iOS:** In progress, no timeline yet.

## What's in the box

- Multi-user auth, first signup becomes admin
- Persistent chat history, auto-titled, full-text searchable
- File uploads — images, PDFs, Word, Excel, CSV, source code
- Projects with per-project system prompts
- Automatic web search via bundled SearXNG, plus a one-message Search action and a persistent hard-disable under Settings → Tools. No API key.
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

No usage analytics, no advertising. The server sends model requests only to endpoints you configure and sends web searches through its configured SearXNG instance. Stored application data lives in a single SQLite file you can copy, back up, or delete.

The Android client can send crash diagnostics to Sentry. These may include technical request metadata; the app does not intentionally attach chat content, attachments, or credentials. Details are in the [privacy policy](https://yoloyash.github.io/overtchat/privacy/).

## Requirements

- Docker + Docker Compose v2
- ~1 GB RAM free for the app stack (Kokoro TTS pulls ~100 MB on first boot)
- An LLM endpoint (API key or self-hosted)

## Stack

Next.js 16 · Vercel AI SDK v7 · Better Auth · Drizzle + SQLite · Redis (resume buffer) · base-ui · Tailwind · SearXNG · Kokoro TTS

## More

- [docs/deploy.md](docs/deploy.md) — updates, backup, troubleshooting

## License

MIT. Fork it, white-label it, ship it. No branding clauses to negotiate around.
