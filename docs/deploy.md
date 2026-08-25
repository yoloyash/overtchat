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

Install dependencies, then start the local web app, Redis, and Host Connector:

```bash
npm install
npm run dev
```

Open [http://localhost:4717](http://localhost:4717). The development command
starts an isolated `overtchat-dev` Redis container, waits for Next.js, provisions
a development connector through the internal management API, and runs the
connector directly from TypeScript. Stop the web app and connector with
Ctrl-C. Next.js and the connector run directly on the host; Docker supplies
Redis only. Redis stays available between runs; stop it with
`npm run dev:down`.

Generated credentials, journals, timelines, and locks live under the ignored
`.overtchat-dev/` directory. Development never reads or changes the installed
connector in `~/.config/overtchat`, its binary, or its systemd service. When a
development database creates a different connector identity, the old runtime
state is moved to a timestamped backup instead of being reused.

Safe localhost defaults are tracked in `apps/web/.env.development`.
Machine-specific URLs and trusted origins still belong in the ignored
`apps/web/.env.local` file. The tracked development environment also clears a
container-only `REDIS_URL`; the full root command supplies its local Redis URL
explicitly.

The root `.env` is the Compose/production configuration. `apps/web/.env` must
remain a symlink to `../../.env` so direct Next.js commands see the same file;
do not replace it with a copy. Next loads `.env.development` and then the
gitignored `.env.local` overrides during development. Mobile has no environment
file because its server URL is selected per device.

For a phone or browser on another development origin, update both mechanisms:
`EXTRA_TRUSTED_ORIGINS` controls Better Auth and CORS, while
`allowedDevOrigins` in `apps/web/next.config.ts` controls Next.js development
assets. Neither setting replaces the other.

Use the narrower commands when the complete stack is not needed:

```bash
npm run dev:web       # Next.js only, without Redis or Agent Connections
npm run dev:mobile    # Expo in its own terminal
npm run dev:site      # marketing site on port 4719
```

Production always includes Redis so the root development command does too.
Running the web workspace alone intentionally exercises the supported fallback
where ordinary streaming works but disconnected streams cannot be resumed.

To use non-default local ports, set `OVERTCHAT_DEV_PORT` or
`OVERTCHAT_DEV_REDIS_PORT`. Search, text-to-speech, and speech-to-text remain
explicit integrations rather than processes hidden inside the default command.

If an incompatible source change makes the disposable connector journal
unreadable, `npm run dev:reset-connector` moves the connector directory to a
timestamped backup. The next `npm run dev` provisions fresh local state.

For a complete managed build from the current worktree, including the Host
Connector and user systemd service, run:

```bash
npm run dev:managed
```

This uses the same managed provisioning path as `overtchat setup`: the CLI
requests connector credentials through the app's internal management endpoint
and installs the user service. This command is for testing the production
installer from source, not for the normal hot-reload development loop. It does
not create or consume a pairing code in Settings.

To debug an installed connector specifically, stop its service so two
processes do not compete for the same production identity, then run the source
process:

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

When an administrator loads the authenticated web app, OvertChat checks the
public release manifest at `overtchat.com` and shows an update indicator on the
account button when a newer app image is available. The account menu includes
the available version. The browser may recheck after reconnecting, returning
to the tab, or reopening a stale account menu; the server does not retain a
process-wide update result. The check does not send an instance identifier,
account data, configuration, or the installed version. For a manual Compose
installation, set
`DISABLE_UPDATE_CHECK=true` in the root `.env` file. For an installation made
with the guided manager, run `DISABLE_UPDATE_CHECK=true overtchat setup` once
to persist the same opt-out.

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

## MCP servers

Admins can add STDIO or Streamable HTTP MCP servers under **Settings → Tools**.
STDIO commands run inside the app container, which includes Node.js, npm, and
npx:

```text
Command: npx
Arguments: -y, @example/mcp-server@1.0.0
```

MCP addresses are resolved from inside the container. Use
`host.docker.internal` for the Docker host or a Compose service name for a
container on the same network. Downloads launched through npm use the separate
`overtchat-npm-cache` volume.

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
