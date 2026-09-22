# Development

Use Node 22 and npm 10.9.8. From the repository root:

```sh
npm install
npm run dev
```

Open [localhost:4717](http://localhost:4717). This starts the web app, an isolated
Redis container, and a source Host Connector. Ctrl-C stops web and connector
processes; `npm run dev:down` stops the retained Redis container. Disposable
connector state lives in `.overtchat-dev/`, separate from production.

## Environment and commands

Development runs with checked-in defaults; copying `.env.example` is optional.
That file is a reference for manual source configuration. Managed installations
use `overtchat setup`, which generates their environment separately.

Defaults are in `apps/web/.env.development`; machine-specific values belong in
`apps/web/.env.local`. The root `.env` configures source development;
`apps/web/.env` must remain a symlink to `../../.env`. For another development
origin, configure `EXTRA_TRUSTED_ORIGINS` and Next.js `allowedDevOrigins`.

| Command or variable | Purpose |
| --- | --- |
| `npm run dev:web` | Web only |
| `npm run dev:mobile` | Expo client |
| `npm run dev:site` | Public site |
| `npm run dev:reset-connector` | Reset an incompatible disposable connector journal |
| `npm run dev:managed` | Exercise production provisioning from the worktree |
| `OVERTCHAT_DEV_PORT` | Override the web port |
| `OVERTCHAT_DEV_REDIS_PORT` | Override the development Redis port |

Chat generation runs on the server. SQLite persists its status and completed
messages; Redis buffers live events for reconnecting clients. Without Redis,
generations still complete and clients recover saved messages, but cannot
replay missed live deltas.

## Mobile validation

For Agent Connections changes:

```sh
npm run typecheck -w apps/mobile --
npm run test -w apps/mobile --
```

Run affected web and bridge checks when shared projections or replicas change.
To validate both native bundles without publishing, run from `apps/mobile`:

```sh
npx expo export --platform android --platform ios --output-dir /tmp/overtchat-mobile-export
```

On Android and iOS, check session creation/resume, web/mobile switching,
background and network recovery, model/permission controls, commands,
approvals/questions, image input, tool output, keyboard clearance, and back
gestures. Use an existing development client unless native modules change.

## Agent rewind and fork validation

Run bridge, runtime, connector, and mobile tests, plus the web agent API and
presentation tests. The browser workflow is covered by
`npm run test:e2e -w apps/web -- e2e/agent-runtime.spec.ts`.

To exercise installed providers with real model requests:

```sh
REWIND_PROVIDERS=claude,codex,pi,omp,opencode npm run test -w packages/agent-runtime -- src/runtime/rewind.integration.test.ts
```

These opt-in tests use disposable local workspaces and incur provider usage.
They check conversation rewind, continued context, restart/resume, and native
file restoration where supported. Set `<PROVIDER>_COMMAND` to override an
executable and `<PROVIDER>_REWIND_MODEL` to select the conversation-test model.
Claude supports conversation, files, and combined rewind; Codex, Pi, and Oh My Pi
support conversation rewind; OpenCode rewinds conversation and files together.
File restoration is limited to the provider's native checkpoints.

Fork tests verify draft creation and text history with concise tool summaries.
Image attachments are omitted. To exercise the connector's SSH process and
tunnel paths against configured aliases:

```sh
REWIND_SSH_ALIASES=linux-host,mac-host npm run test -w apps/connector -- src/rewind-ssh.integration.test.ts
```

The SSH suite tests Claude, Codex, Oh My Pi, and OpenCode, including retained
context, restart/resume, rewind to an empty conversation, and supported file
checkpoints. It uses temporary remote workspaces and makes real model requests.
Each remote login environment must provide the selected executables and model
credentials. The same command/model overrides apply; use Vitest's `-t` option
to select a provider or host. Check browser workflows against the running app
and physical Android/iOS devices separately. The web app and connector must use
the same bridge protocol version.

## OpenCode process lifecycle validation

The connector owns cleanup for local and SSH OpenCode servers. To exercise real
session cancellation, shared server leases, failed SSH cleanup retries, and
recovery after killing a test connector, run:

```sh
RUN_OPENCODE_LIFECYCLE_INTEGRATION=1 npm run test -w apps/connector -- src/opencode-lifecycle.integration.test.ts
```

Set `OPENCODE_COMMAND` if the local executable is not `opencode`. Set
`OPENCODE_SSH_ALIASES=linux-host,mac-host` to include configured OpenSSH aliases;
each remote login environment must provide `opencode`. These tests create and
remove disposable workspaces, sessions, and process records. They run a native
shell tool without making model requests and only terminate helpers they own.

## Library benchmark

Run `npm run bench:library -w apps/web --` without competing builds or tests.
It uses a disposable database with production migrations and synthetic
histories, ignoring `DATABASE_URL`. Results cover 2,000–200,000 messages and
two message sizes, with median and maximum query times across seven warm runs.
HTTP, rendering, concurrent users, and cold caches are excluded.

## README assets

See [README media](readme-media.md) for capture commands, shared fixtures,
and image review.
