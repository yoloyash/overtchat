# Deploy

The guided manager is the supported production installation and update path.
It runs OvertChat with Docker Compose on x86-64 or arm64 Linux.

## Install and configure

```bash
curl -fsSL https://overtchat.com/install | sh
```

The wizard installs Docker when needed and configures the app, optional local
services, realtime voice, and Agent Connections. Realtime voice requires both
speech-to-text and text-to-speech; the wizard offers it after those providers.
Bundled Kokoro and Parakeet services can independently use the CPU or a
detected NVIDIA GPU. GPU services require NVIDIA Container Toolkit; setup can
install it on supported Linux distributions. Kokoro uses roughly 3–4 GB of
VRAM when loaded, so keep one or both speech services on CPU when GPU memory is
limited.
Open the printed URL; the first signup becomes the administrator.

Use the manager for later changes:

```bash
overtchat setup     # reconfigure services or Agent Connections
overtchat status    # show the installed version, URL, and service status
```

Model endpoints and product settings remain in the web app. Bundled services
must first be installed with `overtchat setup`.

Managed configuration lives under `~/.config/overtchat`; generated stack files
and service data live under `~/.local/share/overtchat`. Manual edits to generated
files may be replaced by the next setup or update.

## Adopt an existing installation

Run `overtchat setup` on a machine with a standard `overtchat-app` container to
adopt it. The manager preserves its `/app/data` volume or bind mount, public
port, auth secret, and standard SearXNG configuration. It creates and verifies
a SQLite snapshot before replacing the app or running migrations.

If the old containers are stopped, setup can recover one standard Compose data
volume by its Docker labels. If it finds multiple candidates, start the stack
you want to adopt and run setup again. Setup also converts an existing manually
paired connector into a managed connector.

Custom layouts and source deployments are outside the supported production
update path. Back up their data before migrating to a standard installation.

## Update

```bash
overtchat update
```

This updates the management CLI, app and voice images, selected sidecars, and
managed Host Connector as one coordinated release. Database migrations run
when the app starts without replacing its data mount. If an update stops
partway through, run the command again to reconcile every managed component.

The web app reports newer releases from the public OvertChat manifest. To
disable that check, run `DISABLE_UPDATE_CHECK=true overtchat setup` once.

## Connect other services

Addresses configured in OvertChat must be reachable from the app container:

- For an LLM or another service on the OvertChat host, use
  `http://host.docker.internal:<port>`.
- For existing SearXNG or speech services, run `overtchat setup` and select the
  existing or OpenAI-compatible option. Use a LAN URL for another machine.
- Configure MCP servers under **Settings → Tools**. STDIO commands run inside
  the app container; HTTP servers need a container-reachable URL.

The realtime voice container has no published host port. Browsers connect to
the normal OvertChat origin at `/api/voice/realtime`, and the app proxies that
WebSocket over the private Compose network. HTTPS deployments therefore become
`wss://` automatically and need no second public hostname; the existing reverse
proxy only needs its normal WebSocket-upgrade support for the OvertChat app.

Claude Code connections use the `claude` executable and credentials already
configured on the Host Connector machine. For SSH connections, install and
authenticate Claude Code on the remote host as that SSH user. OvertChat does
not copy or store Claude credentials; each execution target owns its Claude
settings, skills, hooks, and MCP configuration.

## Status, logs, and backup

```bash
# Installation status
overtchat status

# App logs
docker logs -f overtchat-app

# Realtime voice logs, when installed
docker logs -f overtchat-voice

# Backup the SQLite database while the app is running
docker exec overtchat-app sqlite3 /app/data/chat.db ".backup /app/data/backup.db"
docker cp overtchat-app:/app/data/backup.db ./backup.db
```

Common checks:

- An HTTP `307` from `http://localhost:4718` is the healthy login redirect.
- If login redirects back to itself, run `overtchat setup` and correct the
  public URL.
- If the port is occupied, run `overtchat setup` and select another port.

## Development

Install dependencies and start the web app, isolated Redis container, and
source Host Connector:

```bash
npm install
npm run dev
```

Open [http://localhost:4717](http://localhost:4717). Stop the web app and
connector with Ctrl-C; stop the retained development Redis container with
`npm run dev:down`. Disposable connector state lives under `.overtchat-dev/`
and never uses the installed production connector.

Chat generations are owned by the server rather than by one browser or mobile
connection. SQLite records each generation's identity and terminal status;
Redis buffers in-flight stream events so a client can detach and resume after
backgrounding or a network change. Without Redis, generation and final-message
persistence still continue, and clients reconcile the completed response from
SQLite, but missed live deltas cannot be replayed.

Safe defaults are tracked in `apps/web/.env.development`; machine-specific
values belong in `apps/web/.env.local`. The root `.env` is source-development
configuration, and `apps/web/.env` must remain a symlink to `../../.env`. For
another development origin, configure both `EXTRA_TRUSTED_ORIGINS` and Next.js
`allowedDevOrigins`.

Use a narrower process when the full stack is unnecessary:

```bash
npm run dev:web
npm run dev:mobile
npm run dev:site
```

Set `OVERTCHAT_DEV_PORT` or `OVERTCHAT_DEV_REDIS_PORT` for custom ports. Run
`npm run dev:reset-connector` after an incompatible disposable journal change.
To exercise the production provisioning path from the current worktree, run
`npm run dev:managed`.
