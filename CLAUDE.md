# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — ESLint (`eslint-config-next`)
- `npx tsc --noEmit` — typecheck (no test suite yet)
- `docker compose up -d searxng` — start the bundled SearXNG on `127.0.0.1:${SEARXNG_PORT:-8088}`

## Product shape

overtchat is a simpler self-hosted alternative to OpenWebUI. See `ROADMAP.md` for phase plan and explicit non-goals. Load-bearing principles:

- **Bring-your-own endpoint.** The server never holds a model key; the browser sends `baseUrl`/`apiKey`/`model` with every chat request. Do not add server-side env vars for provider credentials.
- **No RAG.** Web search results go straight into context. Never propose embeddings, vector DBs, or chunking.
- **Tool calling, not magic modes.** Search is a tool the model calls when the globe toggle is on. No prompt-injection tricks or forced-search flows.

## Architecture

### Persistent shell + nested route layouts

`app/layout.tsx` → `<AppShell>` (client) → owns `<Sidebar>` + main slot + a React Context holding `{ config, setConfig, chatKey, newChat }`. All routes (chat at `/`, settings at `/settings/*`) render *inside* `<main>`; the sidebar never unmounts across navigation.

This is why `app/settings/layout.tsx` is `h-full`, not `h-screen` — settings fills the main slot only, it does not replace the sidebar.

Config is stored in `localStorage` under `overtchat_config` and synced two ways:
- Same tab: via `AppShell` context + `setConfig` (chat page re-reads on navigation back)
- Cross tab: via `window` `storage` event listener in `AppShell`

### Chat data flow

1. `ChatArea.tsx` uses `useChat` from `@ai-sdk/react` with a `DefaultChatTransport` whose `prepareSendMessagesRequest` injects `baseUrl`, `apiKey`, `model`, `searchEnabled` from refs into every request body.
2. `app/api/chat/route.ts` takes those fields, spins up a per-request `createOpenAICompatible` provider, wraps it with `extractReasoningMiddleware` (parses `<think>` tags into reasoning parts), and streams via `streamText`. Tools are only registered when `searchEnabled` is true; `stopWhen: stepCountIs(5)` caps multi-step tool loops.
3. The UI renders message parts by `part.type`: `text` → `Streamdown` (markdown + KaTeX + Shiki via `@streamdown/code|math|cjk`), `reasoning` → `<ThinkingBlock>`, `tool-web_search` / `tool-fetch_url` → `<ToolCall>` (reads AI SDK v6 state machine: `input-streaming` | `input-available` | `output-available` | `output-error`).

### Web search

`lib/web.ts` has two primitives: `searxngSearch` (hits `SEARXNG_URL` → `{link, title, snippet}[]`) and `fetchReadable` (fetch + `defuddle/node` + `linkedom` → markdown, truncated to 8k chars). `defuddle/node` and `linkedom` are dynamic-imported so cold start stays cheap when search is off.

`lib/tools.ts` wraps both as AI SDK `tool()` definitions with Zod `inputSchema`. Tool name is the object key — changing it breaks the `part.type === "tool-<name>"` switch in `ChatArea`.

## UI conventions

- **Primitives:** base-ui (`@base-ui/react`), not Radix. base-ui uses a `render` prop for composition — e.g. `<Button render={<Link href="/settings" />}>...</Button>` — never `asChild`.
- **Design tokens:** shadcn-style oklch tokens in `app/globals.css` (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, …). Change colors by repointing tokens, not by touching components.
- **Fonts:** Plus Jakarta Sans (`--font-sans`, chrome), Fraunces (`--font-serif` + `--font-heading`, message bodies + headings), Geist Mono (`--font-mono`, code). Wired in `app/layout.tsx` with stable CSS-var names that don't collide with Tailwind theme tokens. Assistant markdown gets `font-serif` at `text-[15px] leading-relaxed`; user bubbles stay sans (Claude-style asymmetric split).
- **Headings:** empty-state h1 is `text-2xl` (matches Claude/ChatGPT sizing at Fraunces's optical weight). Don't go bigger without a reason.

## Gotchas

- **Next.js is ahead of training data.** `AGENTS.md` says it: read `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
- **`searchEnabled` and `config` are captured via refs** inside `prepareSendMessagesRequest` because the transport is created once; don't refactor it to close over state directly or requests will send stale values.
- **Reasoning extraction is hardcoded to `<think>` tags.** DeepSeek-style models work out of the box; other providers that use different conventions will need middleware changes.
- **Tool renaming breaks parts.** If you rename a tool in `lib/tools.ts`, update the `part.type === "tool-<name>"` cases in `ChatArea.tsx` and the discriminators in `ToolCall.tsx`.
