# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — ESLint (`eslint-config-next`)
- `npx tsc --noEmit` — typecheck (no test suite yet)
- `docker compose up -d searxng` — start the bundled SearXNG on `127.0.0.1:${SEARXNG_PORT:-8088}`
- `npm run auth:generate` — regenerate `lib/db/schema.ts` from Better Auth config
- `npm run db:generate` — generate a new Drizzle migration after schema changes
- `npm run db:studio` — Drizzle Studio against `data/chat.db`

## Product shape

overtchat is a simpler self-hosted alternative to OpenWebUI. Load-bearing principles:

- **Bring-your-own endpoint.** The server never holds a model key; the browser sends `baseUrl`/`apiKey`/`model` with every chat request. Do not add server-side env vars for provider credentials.
- **No RAG.** Web search results go straight into context. Never propose embeddings, vector DBs, or chunking.
- **Tool calling, not magic modes.** Search is a tool the model calls when the globe toggle is on. No prompt-injection tricks or forced-search flows.

## Architecture

### Route groups + persistent shell

Two top-level groups under `app/`:

- **`(auth)`** — `/login`, `/signup`. Centered card, no sidebar. Public routes (signup is additionally gated to "only when 0 users exist" server-side).
- **`(app)`** — `/`, `/settings/*`. `layout.tsx` here validates the session server-side and `redirect("/login")` on miss, then wraps children in `<AppShell>` (client) → `<Sidebar>` + main slot + React Context `{ config, setConfig, chatKey, newChat }`. Every protected route re-runs the layout; the sidebar never unmounts across in-group navigation.

`app/(app)/settings/layout.tsx` is `h-full`, not `h-screen` — settings fills the main slot, it doesn't replace the sidebar.

Config is stored in `localStorage` under `overtchat_config` and synced two ways:
- Same tab: via `AppShell` context + `setConfig` (chat page re-reads on navigation back)
- Cross tab: via `window` `storage` event listener in `AppShell`

### Chat data flow

1. `ChatArea.tsx` uses `useChat` from `@ai-sdk/react` with a `DefaultChatTransport` and passes `baseUrl`, `apiKey`, `model`, `searchEnabled` through `sendMessage(msg, { body })` on each send — a fresh snapshot per request.
2. `app/api/chat/route.ts` validates the session (401 if absent), spins up a per-request `createOpenAICompatible` provider, wraps it with `extractReasoningMiddleware` (parses `<think>` tags into reasoning parts), and streams via `streamText`. Tools are only registered when `searchEnabled` is true; `stopWhen: stepCountIs(10)` caps multi-step tool loops.
3. The UI renders message parts by `part.type`: `text` → `Streamdown` (markdown + KaTeX + Shiki via `@streamdown/code|math|cjk`), `reasoning` → `<ThinkingBlock>`, `tool-web_search` / `tool-fetch_url` → `<ToolCall>` (reads AI SDK v6 state machine: `input-streaming` | `input-available` | `output-available` | `output-error`).

### Web search

`lib/web.ts` has two primitives: `searxngSearch` (hits `SEARXNG_URL` → `{link, title, snippet}[]`) and `fetchReadable` (fetch + `defuddle/node` + `linkedom` → markdown, truncated to 8k chars). `defuddle/node` and `linkedom` are dynamic-imported so cold start stays cheap when search is off.

`lib/tools.ts` wraps both as AI SDK `tool()` definitions with Zod `inputSchema`. Tool name is the object key — changing it breaks the `part.type === "tool-<name>"` switch in `ChatArea`.

### Data & auth

- **SQLite via Drizzle**, single connection in `lib/db/client.ts`. `better-sqlite3` with WAL mode + foreign keys on. Migrations in `drizzle/` run at import time — no separate deploy step. DB lives at `./data/chat.db` (gitignored, bind-mounted in production). Override with `DATABASE_URL`.
- **Better Auth** in `lib/auth/server.ts`. Email+password only, `disableSignUp: true` (public signup endpoint closed). `admin` plugin provides roles (`admin` + `user`) and user management API. `nextCookies()` plugin must stay last so server actions can set cookies.
- **First-user-admin bootstrap**: `databaseHooks.user.create.before` promotes the first user to `admin`. `/signup` page re-checks `count(user) === 0` server-side and server-action-invokes `auth.api.signUpEmail` — after that, signup redirects to `/login`. Additional users come in via `authClient.admin.createUser(...)` from `/settings/users` (admin-only).
- **Session validation**: `auth.api.getSession({ headers })` works in server components, route handlers, and middleware. `(app)/layout.tsx` already guards all protected routes; `/api/chat` additionally guards itself for 401s on raw fetches. Admin-only pages check `session.user.role === "admin"` in the page server component and redirect on miss — UI-level filtering in `SettingsNav` is UX, not security.
- **Endpoint config stays in `localStorage`.** The server never sees it except as a request body field on `/api/chat`. Do not propose moving it to the DB.
- **Schema evolution**: change auth config → `npm run auth:generate` → `npm run db:generate` → commit the new `drizzle/*.sql`. Migration runs on next boot.

## UI conventions

- **Primitives:** base-ui (`@base-ui/react`), not Radix. base-ui uses a `render` prop for composition — e.g. `<Button render={<Link href="/settings" />}>...</Button>` — never `asChild`.
- **Design tokens:** shadcn-style oklch tokens in `app/globals.css` (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, …). Change colors by repointing tokens, not by touching components.
- **Fonts:** Plus Jakarta Sans (`--font-sans`, chrome), Fraunces (`--font-serif` + `--font-heading`, message bodies + headings), Geist Mono (`--font-mono`, code). Wired in `app/layout.tsx` with stable CSS-var names that don't collide with Tailwind theme tokens. Assistant markdown gets `font-serif` at `text-[15px] leading-relaxed`; user bubbles stay sans (Claude-style asymmetric split).
- **Headings:** empty-state h1 is `text-2xl` (matches Claude/ChatGPT sizing at Fraunces's optical weight). Don't go bigger without a reason.

## Gotchas

- **Next.js is ahead of training data.** `AGENTS.md` says it: read `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
- **Reasoning extraction is hardcoded to `<think>` tags.** DeepSeek-style models work out of the box; other providers that use different conventions will need middleware changes.
- **Tool renaming breaks parts.** If you rename a tool in `lib/tools.ts`, update the `part.type === "tool-<name>"` cases in `ChatArea.tsx` and the discriminators in `ToolCall.tsx`.
- **Server components importing `lib/db/client.ts` pin the route to the Node runtime.** `better-sqlite3` is a native module — don't export `runtime = "edge"` on any route that touches the DB.
