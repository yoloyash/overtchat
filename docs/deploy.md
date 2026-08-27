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

Web search uses the selected provider as its primary. When Brave is selected,
an installed or configured SearXNG service is used automatically if Brave
fails or returns no useful results. OvertChat then tries Firecrawl, Exa, and
DuckDuckGo in order, stopping after the first useful response. Those public
backup providers receive the query only when the providers before them cannot
answer. Search activity records which provider ultimately served the results.

## Adopting an existing Compose installation

Running `overtchat setup` on a machine that already has the standard
`overtchat-app` container adopts it in place. The installer preserves the
current `/app/data` Docker volume or bind mount, public port, auth secret, and
standard SearXNG configuration. If the containers were removed with
`docker compose down`, it can recover a single standard Compose data volume by
its Docker labels. After adoption, use `overtchat setup`, `overtchat status`,
and `overtchat update` instead of the old Compose workflow.

If more than one candidate data volume exists, start the specific old stack
before running setup so the manager can identify it. Custom layouts and source
deployments are not part of the supported production update path; back up their
data and migrate it into a standard installation instead of expecting the
manager to modify an ambiguous deployment.

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

The root `.env` is source-development configuration. Managed production
settings live under `~/.config/overtchat` and must be changed through
`overtchat setup` or the product settings. `apps/web/.env` must remain a
symlink to `../../.env` so direct Next.js commands see the development file;
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
account data, configuration, or the installed version. Run
`DISABLE_UPDATE_CHECK=true overtchat setup` once to persist an opt-out.

Running `overtchat setup` adopts an older manually paired connector, rotates
its credentials, and brings it under managed updates.

## Pointing at your LLM

The app container makes the upstream LLM calls, so the base URL you set in **Settings → API endpoint** needs to be reachable **from inside the container**, not from your browser.

- **LLM running on the host:** use `http://host.docker.internal:<port>/v1`.
  The managed stack provides this hostname on Linux.
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

## Using existing search and speech services

Run `overtchat setup` and select **Existing SearXNG** or an
**OpenAI-compatible API** for speech. Enter a URL reachable from the app
container. Use `host.docker.internal` for a service running on the OvertChat
host, or use a LAN URL for another machine.

## Status, logs, and backup

```bash
# Installation status
overtchat status

# App logs
docker logs -f overtchat-app

# Backup the DB (safe while running)
docker exec overtchat-app sqlite3 /app/data/chat.db ".backup /app/data/backup.db"
docker cp overtchat-app:/app/data/backup.db ./backup.db
```

The manager owns the generated Compose and environment files. Manual edits to
those files may be replaced by the next `overtchat setup` or `overtchat update`.

## Troubleshooting

- **`curl -I http://localhost:4718` returns `307`** — healthy (redirect to `/login`).
- **Login succeeds, next page redirects back to login** — the configured public
  URL does not match what the browser sees. Run `overtchat setup` and correct
  the URL.
- **Port already in use** — run `overtchat setup` and choose another port.
- **An update stops partway through** — run `overtchat update` again. It
  reconciles every managed component against the current release manifest.
