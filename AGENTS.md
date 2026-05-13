# AGENTS.md

This file provides guidance to AI Agents (Claude, Codex, Gemini, etc.) when working with code in this repository.

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

- **Admin-managed OpenAI-compatible endpoints.** Admins create model configs (label + baseUrl + apiKey + model + optional extraBody) in Settings → Models; these are stored in the `model_configs` table. Regular users only see the label and pick one from a dropdown. The client never sees credentials.
- **No RAG.** Web search results go straight into context. Never propose embeddings, vector DBs, or chunking.
- **Tool calling, not magic modes.** Search is a tool the model calls when the globe toggle is on. No prompt-injection tricks or forced-search flows.

## Architecture

### Route groups + persistent shell

Two top-level groups under `app/`:

- **`(auth)`** — `/login`, `/signup`. Centered card, no sidebar.
- **`(app)`** — `/`, `/chat/[id]`, `/settings/*`. `layout.tsx` validates the session server-side and `redirect("/login")` on miss, then wraps children in `<AppShell>` (client) which renders `<Sidebar>` in a responsive shell: visible on `md+`, hidden behind a `base-ui` `Dialog` on mobile with `<SidebarToggle>` as the trigger. Every protected route re-runs the layout; the server-rendered sidebar re-fetches chats on navigation.

`app/(app)/settings/layout.tsx` is `h-full`, not `h-screen` — settings fills the main slot, it doesn't replace the sidebar.

The only client-side persisted state is two localStorage keys, read/written via `lib/useLocalStorage.ts` (`useSyncExternalStore` with a cross-tab listener):
- `overtchat_selected_model` — id of the model config the user picked in `ModelPicker`
- `overtchat_search_enabled` — globe toggle state

### Chat data flow

1. `ChatArea.tsx` uses `useChat` from `@ai-sdk/react` with a `DefaultChatTransport` and passes `{ modelConfigId, searchEnabled, chatId }` through `sendMessage(msg, { body })` on each send. On the first send of a new chat, it mints a UUID client-side and `history.replaceState`s the URL to `/chat/<id>` without navigating.
2. `app/api/chat/route.ts` validates the session (401 if absent), loads the model config from the DB, persists the incoming user message, then spins up a per-request `createOpenAICompatible` provider from the config's `baseUrl`/`apiKey`/`model`. It wraps the model with `extractReasoningMiddleware` (parses `<think>` tags into reasoning parts), passes `modelConfig.extraBody` as `providerOptions["user-endpoint"]`, and streams via `streamText`. Tools are only registered when `searchEnabled` is true; `stopWhen: stepCountIs(10)` caps multi-step tool loops. On finish, the assistant message is appended and a title is generated asynchronously via `generateText` against the same wrapped model.
3. The UI renders message parts by `part.type`: `text` → `Streamdown` (markdown + KaTeX + Shiki via `@streamdown/code|math|cjk`), `reasoning` → `<ThinkingBlock>`, `tool-web_search` / `tool-fetch_url` → `<ToolCall>` (reads AI SDK v6 state machine: `input-streaming` | `input-available` | `output-available` | `output-error`).

Edit + regenerate both reuse `/api/chat`: the client passes `trigger: "submit-message" | "regenerate-message"` and a `messageId`; the server calls `deleteMessagesFrom(chatId, messageId)` before streaming.

### Uploads (images)

Images are uploaded to `POST /api/uploads` (multipart), written to disk at `./data/uploads/<uuid>`, and a row is inserted into `uploads`. The browser gets back a `/api/uploads/<id>` URL it can render. When the chat route runs, `inlineUploads()` rewrites those URLs into `data:` URIs so upstream providers can fetch the bytes without our auth. Orphaned uploads (not referenced by any message after 24h) are swept by `sweepOrphanedUploads()`, kicked off once per server start from `instrumentation.ts`'s `register()` hook.

### Web search

`lib/web.ts` has two primitives: `searxngSearch` (hits `SEARXNG_URL` → `{link, title, snippet}[]`) and `fetchReadable` (fetch + `defuddle/node` + `linkedom` → markdown, truncated to 8k chars). `defuddle/node` and `linkedom` are dynamic-imported so cold start stays cheap when search is off.

`lib/tools.ts` wraps both as AI SDK `tool()` definitions with Zod `inputSchema`. Tool name is the object key — changing it breaks the `part.type === "tool-<name>"` switch in `ChatArea` and the discriminators in `ToolCall`.

### Data & auth

- **SQLite via Drizzle**, single connection in `lib/db/client.ts`. `better-sqlite3` with WAL mode + foreign keys on. Migrations in `drizzle/` are applied by `drizzle-kit migrate` chained into `npm run dev` and `npm run start` — migrations finish before the server binds. DB lives at `./data/chat.db` (gitignored, bind-mounted in production). Override with `DATABASE_URL`.
- **Better Auth** in `lib/auth/server.ts`. Email+password only. `admin` plugin provides roles (`admin` + `user`) and user management API. `nextCookies()` plugin must stay last so server actions can set cookies.
- **First-user-admin bootstrap**: `databaseHooks.user.create.before` is authoritative — it promotes the first user to `admin` and rejects all other unauthenticated creates with `APIError("BAD_REQUEST")`. `/signup` is just a UX shell: the page redirects to `/login` when users exist, and the server action `bootstrapSignUp` re-checks the count before calling `auth.api.signUpEmail`. Additional users come in via `authClient.admin.createUser(...)` from `/settings/users` (admin-only).
- **Session validation**: `auth.api.getSession({ headers })` works in server components and route handlers. `(app)/layout.tsx` already guards all protected routes. Admin-only pages and routes check `session.user.role === "admin"` and return 403 / redirect on miss — UI-level filtering in `SettingsNav` is UX, not security.
- **Model config credentials stay server-side.** `/api/model-configs` returns `{ id, label, model, hasExtraBody }` by default; only admins (via `?admin=1`) get the full row with `baseUrl`/`apiKey`. Anything that exposes credentials to non-admins is a bug.
- **Schema evolution**: change auth config → `npm run auth:generate` → `npm run db:generate` → commit the new `drizzle/*.sql`. Migration runs on next boot.

### Tables

- `user`, `session`, `account`, `verification` — owned by Better Auth, do not hand-edit
- `chats` — `{ id, userId, title, createdAt, updatedAt }`, indexed on `(userId, updatedAt)`
- `messages` — `{ id, chatId, role, parts (JSON), createdAt }`; `parts` is the full AI SDK `UIMessagePart[]` so we can round-trip tool calls and reasoning
- `uploads` — `{ id, userId, filename, mediaType, createdAt }`; bytes live on disk under `./data/uploads/<id>`
- `model_configs` — `{ id, label, baseUrl, apiKey, model, extraBody (JSON), sortOrder, ... }`

## UI conventions

- **Primitives:** base-ui (`@base-ui/react`), not Radix. base-ui uses a `render` prop for composition — e.g. `<Button render={<Link href="/settings" />}>...</Button>` — never `asChild`.
- **Design tokens:** shadcn-style oklch tokens in `app/globals.css` (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, …). Change colors by repointing tokens, not by touching components.
- **Fonts:** Plus Jakarta Sans (`--font-sans`, chrome), Fraunces (`--font-serif` + `--font-heading`, message bodies + headings), Geist Mono (`--font-mono`, code). Wired in `app/layout.tsx` with stable CSS-var names that don't collide with Tailwind theme tokens. Assistant markdown gets `font-serif` at `text-[15px] leading-relaxed`; user bubbles stay sans (Claude-style asymmetric split).
- **Headings:** empty-state h1 is `text-2xl` (matches Claude/ChatGPT sizing at Fraunces's optical weight). Don't go bigger without a reason.

## Gotchas

- **Next.js is ahead of training data.** `AGENTS.md` says it: read `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
- **Reasoning extraction is hardcoded to `<think>` tags.** DeepSeek-style models work out of the box; other providers that use different conventions will need middleware changes.
- **Title generation reuses the chat model.** `maybeGenerateTitle` calls `generateText` with the same `wrapped` model, so `extractReasoningMiddleware` is still active — a model that only emits `<think>…</think>` with no post-tag content will return empty text, and the code falls back to the first 40 chars of the user message.
- **Tool renaming breaks parts.** If you rename a tool in `lib/tools.ts`, update the `part.type === "tool-<name>"` cases in `ChatArea.tsx` and the discriminators in `ToolCall.tsx`.
- **Orphan-upload sweep is a per-candidate `LIKE '%<id>%'` scan over `messages.parts`.** Fine at current scale; revisit if the uploads table grows large.
- **Server components importing `lib/db/client.ts` pin the route to the Node runtime.** `better-sqlite3` is a native module — don't export `runtime = "edge"` on any route that touches the DB.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
