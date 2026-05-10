# overtchat

A simpler self-hosted alternative to OpenWebUI. Bring your own OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, OpenAI, Groq, anything). One `docker compose up` and you're in.

- Multi-user auth, first signup becomes admin
- Persistent chat history, auto-titled
- Web search via bundled SearXNG (no external API keys)
- Reasoning models (DeepSeek, Qwen3) render `<think>` blocks natively
- Tool calling — search runs when the model asks for it, not on a timer
- No RAG, no embeddings, no vector DB. Results go straight into context.

## Quick start

```bash
git clone https://github.com/yoloyash/overtchat
cd overtchat
cp .env.example .env
```

Generate a secret and write it into `.env`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
```

Then bring it up:

```bash
docker compose up -d --build
```

Open [http://localhost:4718](http://localhost:4718). First signup becomes admin. Go to **Settings → API endpoint** and point it at your LLM:

- **Ollama / vLLM / llama.cpp on the same host:** `http://host.docker.internal:<port>/v1`
- **OpenAI / Groq / any public provider:** the provider's base URL + API key

Hit "Test connection" to populate the model list, pick one, save.

To open it up to other devices on your LAN, set `BETTER_AUTH_URL` in `.env` to your host's LAN IP (e.g. `http://192.168.1.50:4718`) and `docker compose up -d`.

## Stack

Next.js 16 · Vercel AI SDK v6 · Better Auth · Drizzle + SQLite · base-ui · Tailwind · SearXNG

## More

- [docs/deploy.md](docs/deploy.md) — updates, backup, troubleshooting
