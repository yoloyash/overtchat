# Web app guidance

This workspace is the self-hosted OvertChat product: a Next.js App Router
server, browser client, mobile API, and SQLite persistence layer. SQLite is the
application source of truth. Redis is optional infrastructure for reconnectable
chat delivery.

## Architecture

- `app/(app)` contains authenticated product routes, `app/(auth)` contains
  login and bootstrap signup, and `app/api` serves browser and mobile clients.
- `components/AppShell.tsx`, `components/Sidebar.tsx`, and
  `components/chat/ChatArea.tsx` form the main browser application.
- `lib/db` owns schema, queries, transactions, migrations, and search indexing.
- `lib/providers` owns provider definitions, model discovery, generated model
  metadata, protocol adapters, and AI SDK model construction.
- `lib/chat` owns chat request validation and message helpers; `lib/streams`
  owns cancellation and optional reconnectable-stream integration.
- `lib/capabilities` validates search and speech configuration;
  `lib/db/serverCapabilities.ts` persists it.
- `lib/agents` owns Agent Connections projections and access rules.
  `lib/agents/connector` owns the authorized web-side connector relay.
- `lib/mcp` owns MCP configuration, connections, tool bindings, and lifecycle.
- `lib/queries` owns client-side React Query keys, queries, and mutations.

## Authentication boundaries

Better Auth sessions authorize browser and mobile APIs. Database operations
must also scope resources by the authenticated user; checking only that a
session exists is insufficient.

Host Connector routes authenticate connector tokens. Internal management routes
authenticate `OVERTCHAT_MANAGEMENT_SECRET`. Keep both separate from user
sessions, and never expose connector tokens, management secrets, provider keys,
or executable MCP configuration through user APIs.

The first created user becomes the administrator. Public signup closes after
that; administrators create subsequent users through Better Auth's admin path.

## Chat and persistence

`app/api/chat/route.ts` is the streaming orchestration boundary. Validate and
authorize the complete request, resolve the provider and project, inline
uploads, and convert messages before mutating persistent state.

Saved turns use `commitChatTurn()` and `completeChatStream()` from
`lib/db/chatTurns.ts`. Preserve their transaction boundaries, stream-ID
ownership, edit/regenerate truncation, message and FTS consistency, usage
recording, and partial-response behavior.

Temporary chats do not claim streams or persist chats, messages, titles, search
records, or usage. Redis-backed resumability changes stream delivery only; it
does not replace SQLite persistence.

Messages persist AI SDK `UIMessage` identity, role, parts, and metadata.
Rendering, attachments, export, and search extraction consume that
representation; do not introduce a parallel plain-text message model.

## Providers and tools

Provider identity comes from `model_configs.provider_id`, never from endpoint
URLs. Adding a provider requires its catalog definition, one adapter under
`lib/providers/server/adapters`, registry wiring, discovery behavior, and
contract tests. Chat routes must remain provider-neutral.

`lib/providers/server/model-catalog.json` and its manifest are generated,
committed inputs for offline capability and pricing defaults. Update and
validate them through the catalog scripts; commit both artifacts.

Web search and URL retrieval go through `@yoloyash/web-basics`, which owns
redirect, extraction, size, and SSRF policy.

MCP input is validated in `lib/mcp/schema.ts`. STDIO configuration remains
structured as command, arguments, environment, passthrough, and working
directory. `lib/mcp/manager.ts` scopes runtimes by user and chat; release
bindings after generation and preserve invalidation, idle-close, and
chat-deletion cleanup.

## Agent Connections

`lib/agents/connector/broker.ts` owns live connector channels, request dispatch,
reconnect handling, and subscriptions. It is process-local; durable connection,
workspace, and session metadata belongs in `lib/db`.

`lib/agents/sessionReplica.ts` projects connector snapshots and ordered events
for the browser UI. It is not an independent runtime or persistence layer.
Preserve cursor, epoch, and sequence reconciliation when changing the
agent-session APIs or SSE client.

A command can have an unknown outcome when the connector disconnects. Do not
automatically replay it unless the connector command journal makes that
operation replay-safe.

Protocol payloads come from `@overtchat/agent-bridge`. Provider transcript
normalization remains in the runtime/connector; web-specific presentation
belongs in `lib/agents/presentation.ts`.

## Database and startup

`lib/db/schema.ts` is authoritative. Generate and review a Drizzle migration
after schema changes and commit both. Published migrations are immutable.

Changes to searchable message data must update `lib/search/extract.ts` together
with the FTS schema, triggers, migrations, and focused tests.

`npm run auth:generate` replaces `lib/db/schema.ts` with Better Auth's fragment.
Use the result as an update source, restore the application tables, and only
then generate a migration.

`instrumentation.ts` is the Node.js startup boundary for migrations, capability
defaults, and maintenance. The production build uses standalone output; add
runtime files that imports cannot trace to `next.config.ts`.

## Client conventions

React Query owns remote client state. Define reusable keys in
`lib/queries/keys.ts` and update or invalidate affected caches after mutations
and stream completion.

Shared theme values come from `@overtchat/shared/theme.css`; web-specific tokens
remain in `app/globals.css`.

Use `@/*` for workspace imports. Run focused tests while iterating, then the web
typecheck, lint, and build. Auth, chat persistence, migrations, connector
transport, and import/export changes require their relevant integration or E2E
coverage.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
