# Repository guidance

OvertChat is a self-hosted chat application for local and hosted LLMs, with
web/mobile clients and optional coding-agent control. Users own the server and
data; a host-native connector runs Codex, Claude Code, Pi, Oh My Pi, and
OpenCode sessions locally or over SSH.

## Sources of truth

- `docs/deploy.md` owns development setup, environment loading, managed
  installation, deployment, and operator procedures.
- `docs/release.md` owns version, tag, artifact, promotion, and release-specific
  validation procedures.
- `docs/android.md` is the end-user Android installation guide.

Update a runbook when its process changes. In `AGENTS.md`, link to the owning
runbook instead of copying its instructions.

## Repository map and ownership

| Path | Responsibility |
| --- | --- |
| `apps/web` | Self-hosted Next.js product: UI, auth, SQLite persistence, chat APIs, and the authenticated Host Connector relay |
| `apps/mobile` | Expo client for an operator-supplied OvertChat server |
| `apps/site` | Static `overtchat.com` export, installer assets, and release manifest |
| `apps/cli` | Linux management CLI for setup, adoption, updates, and managed Compose state |
| `apps/connector` | Host-native daemon that owns live coding-agent sessions and process execution |
| `packages/agent-bridge` | Exact web-to-connector protocol and shared agent data contracts |
| `packages/agent-runtime` | Coding-agent provider adapters plus host runtime primitives |
| `packages/shared` | Cross-client chat/tool/model contracts and generated web/native theme outputs |
| `scripts/dev.mjs` | Root development-stack orchestration |
| `compose.yml`, `searxng/`, `stt/`, `voice/` | Self-hosted application and bundled sidecars |
| `.github/` | Validation, artifact publication, and release promotion automation |

Keep these boundaries strict:

- The connector is the only product process that spawns coding agents or uses
  the user's SSH configuration. The web app authorizes and relays; it does not
  import `@overtchat/agent-runtime` or reconstruct live runtime state.
- `agent-bridge` defines transport-neutral contracts and validation.
  `agent-runtime` implements providers against those contracts. Product UI and
  durable database models stay out of both packages.
- `packages/shared` must remain usable by every target that imports a given
  export. Platform-specific theme representations use the existing export
  paths rather than runtime platform branching.

## Commands

Use Node 22 and npm 10.9.8. The npm version is repeated in `package.json`,
`Dockerfile`, and CI workflows; update those pins and regenerate
`package-lock.json` together.

Run commands from the repository root unless a scoped file says otherwise:

- `package.json` is the command registry; use an existing package script when
  one covers the task.
- `npm run <script> -w <workspace> --` targets one workspace.

Run the narrowest relevant checks while iterating, then widen validation for
cross-workspace or release-sensitive changes.

## Repository conventions

- Workspace packages export TypeScript source directly. Do not introduce a
  package build step unless all consumers and Turbo dependencies are updated
  together.
- Add a scoped `AGENTS.md` only when a subtree has distinct ownership,
  invariants, or validation.
