# Deploy

The managed installer runs OvertChat on the current Linux machine with Docker
Compose. It supports x86-64 and arm64.

## One-time setup

```bash
curl -fsSL https://overtchat.com/install | sh
```

The terminal wizard configures web search, TTS, STT, and optional Agent
Connections. Docker is detected automatically and can be installed when it is
missing. For local STT, the wizard detects NVIDIA GPUs by stable UUID and lets
you select Auto, a specific device, or CPU.

Open the printed URL. The first user to sign up becomes the admin. Model setup
continues in the web app.

The managed files live under `~/.config/overtchat` and
`~/.local/share/overtchat`. Re-run setup whenever you want to install an
optional bundled service that was skipped initially:

```bash
overtchat setup
```

Provider selection can also be changed later in **Admin Settings → Services**.
Bundled services must first be installed with `overtchat setup`.

## Existing Compose installations

Running `overtchat setup` on a machine that already has the standard
`overtchat-app` container adopts it in place. The installer preserves the
current `/app/data` Docker volume or bind mount, public port, auth secret, and
standard SearXNG configuration. If the containers were removed with
`docker compose down`, it can recover a single standard Compose data volume by
its Docker labels.

The old Compose commands remain supported. If more than one candidate data
volume exists or the installation uses unrelated container names, start the
specific old stack first or continue managing that custom layout manually.

## Development

Run the app on the host and Redis in Docker:

```bash
npm install
docker compose -f compose.yml -f compose.dev.yml up -d redis
npm run dev
```

Open [http://localhost:4717](http://localhost:4717). Add `searxng` or `kokoro` to the Compose command when working on search or text-to-speech.

For a complete managed build from the current worktree, including the Host
Connector, run:

```bash
npm run dev -w apps/cli -- setup --development
```

This uses the same managed provisioning path as `overtchat setup`: the CLI
requests connector credentials through the app's internal management endpoint
and installs the user service. It does not create or consume a pairing code in
Settings.

To debug the connector TypeScript process after it has been provisioned, stop
the installed service so the two processes do not compete for the same
identity, then run the source process:

```bash
systemctl --user stop overtchat-connector.service
npm run dev -w apps/connector
```

The source process reads `~/.config/overtchat/connector.json`; its `run`
command does not accept `--server`. Restart the installed service when done.

## Deploying updates

```bash
overtchat update
```

This updates the management CLI, app image, selected local sidecars, and managed
Agent Connector as one coordinated release. Database migrations run
automatically when the app starts; the existing data mount is not replaced.

Running `overtchat setup` adopts an older manually paired connector, rotates
its credentials, and brings it under managed updates.

## Manual Compose installation

For source development, custom orchestration, or non-Linux hosts, clone the
repository and use the original Compose flow:

```bash
git clone https://github.com/yoloyash/overtchat
cd overtchat
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Set `BETTER_AUTH_URL` in `.env` to the URL browsers will use. Manual installs
update with `git pull && docker compose up -d --build`.

## Pointing at your LLM

The app container makes the upstream LLM calls, so the base URL you set in **Settings → API endpoint** needs to be reachable **from inside the container**, not from your browser.

- **LLM running on the host (not in docker):** use `http://host.docker.internal:<port>/v1`. Baked into `compose.yml` via `extra_hosts`, works on Linux / macOS / Windows.
- **Public provider (OpenAI / Groq / etc.):** use the provider's base URL + API key.

## Reusing sidecars

SearXNG and Kokoro are bundled by default. To point the app at existing services, set container-reachable URLs in `.env`:

```env
OVERTCHAT_SEARXNG_URL=http://host.docker.internal:8088
OVERTCHAT_KOKORO_URL=http://host.docker.internal:8880
OVERTCHAT_STT_URL=http://host.docker.internal:5092
```

This changes where the app connects. To also stop the bundled containers from starting, add this to your local `compose.override.yml`:

```yaml
services:
  searxng:
    profiles: ["disabled"]
  kokoro:
    profiles: ["disabled"]
```

Docker Compose loads `compose.override.yml` automatically; this repo ignores it. If you already use that file for local networks or other overrides, merge these service entries into it.

Then run the usual command:

```bash
docker compose up -d
```

Use `host.docker.internal` for services running on the Docker host, or a LAN/container URL for services running elsewhere.

## Common ops

```bash
# Tail logs
docker compose logs -f app

# Stop everything
docker compose down

# Backup the DB (safe while running)
docker compose exec app sqlite3 /app/data/chat.db ".backup /app/data/backup.db"
docker compose cp app:/app/data/backup.db ./backup.db
```

## Troubleshooting

- **`curl -I http://localhost:4718` returns `307`** — healthy (redirect to `/login`).
- **Login succeeds, next page redirects back to login** — `BETTER_AUTH_URL` mismatch with what the browser sees. Fix in `.env`, then `docker compose up -d`.
- **Port already in use** — change `APP_PORT` in `.env`.
- **Schema errors after pull** — you didn't rebuild. `docker compose up -d --build`.
