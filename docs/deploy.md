# Deploy

Single-compose, self-hosted, LAN-only. Assumes Docker + Docker Compose v2 on the target machine.

## One-time setup

```bash
git clone <repo>
cd overtchat
cp .env.example .env
```

Edit `.env`:

- `BETTER_AUTH_SECRET` — required. Generate with `openssl rand -hex 32`.
- `SEARXNG_SECRET` — required. Generate with `openssl rand -hex 32`.
- `BETTER_AUTH_URL` — the URL the browser will hit (scheme + host + port). For LAN access from other devices, set it to your host's LAN IP, e.g. `http://192.168.1.50:4718`.

Then:

```bash
docker compose up -d --build
```

First boot takes ~30s because the Kokoro TTS container downloads its model. Subsequent boots are fast.

Open the URL. First user signs up → becomes admin. Add more users from `/settings/users`.

## Deploying updates

```bash
git pull
docker compose up -d --build
```

Compose only recreates the container if the image changed. Migrations run automatically on boot. Data in the `overtchat-data` volume persists across rebuilds.

## Pointing at your LLM

The app container makes the upstream LLM calls, so the base URL you set in **Settings → API endpoint** needs to be reachable **from inside the container**, not from your browser.

- **LLM running on the host (not in docker):** use `http://host.docker.internal:<port>/v1`. Baked into `compose.yml` via `extra_hosts`, works on Linux / macOS / Windows.
- **Public provider (OpenAI / Groq / etc.):** use the provider's base URL + API key.

## Common ops

```bash
# Tail logs
docker compose logs -f app

# Restart just the app
docker compose restart app

# Stop everything
docker compose down

# Backup the DB (safe while running)
docker compose exec app sqlite3 /app/data/chat.db ".backup /app/data/backup.db"
docker compose cp app:/app/data/backup.db ./backup.db

# Nuke everything including data
docker compose down -v

# Rebuild from scratch
docker compose down && docker compose up -d --build --force-recreate
```

## Troubleshooting

- **`curl -I http://localhost:4718` returns `307`** — healthy (redirect to `/login`).
- **Login succeeds, next page redirects back to login** — `BETTER_AUTH_URL` mismatch with what the browser sees. Fix in `.env`, then `docker compose up -d`.
- **Port already in use** — change `APP_PORT` in `.env`.
- **Schema errors after pull** — you didn't rebuild. `docker compose up -d --build`.
