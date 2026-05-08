# overtchat roadmap

A simpler self-hosted alternative to OpenWebUI / LobeChat / LibreChat. Bring your own OpenAI-compatible endpoint. One `docker compose up` and it works — including web search.

## Guiding principles

- **Just works.** Defaults ship pre-configured. No docs required for first use.
- **No RAG.** Web search results go straight into context. No embeddings, no vector DB, no chunking.
- **Tool calling over magic modes.** Search is a tool the model calls, not a UI toggle that silently rewrites prompts.
- **Self-hosted, multi-user from day one.** Auth is infrastructure, not a feature.

## Phases

### 1. Basic chat + API endpoint modal
Minimal chat UI. Modal to configure an OpenAI-compatible base URL + API key. Streaming responses. Persist config in localStorage for now.

### 2. Minimal auth (stub)
Single admin account, password login, sessions. Purpose: establish `user_id` as a foreign key before any user-scoped data exists. Do **not** skip this — retrofitting auth onto an existing history schema is painful.

### 3. History + settings (per-user)
Conversation list, rename, delete. Per-user settings page (default model, system prompt, etc.). Schema has `user_id` from the start.

### 4. Image support
OpenAI-style `image_url` content parts, base64 upload. Per-model vision toggle (no reliable way to auto-detect, so let the user mark which configured models support images).

### 5. Web search via SearXNG
Ship `compose.yml` with a bundled, pre-configured SearXNG service. Exposed to the model as a `web_search` tool call:

1. `GET searxng:8080/search?q=<query>&format=json`
2. Take top N results (default 3)
3. Fetch each URL in parallel, extract readable text, truncate to a content budget
4. Return as tool result — model cites URLs in its reply

Reference config already working at `../local-chat/` — copy `searxng/settings.yml` and the relevant env vars from the `open-webui` service in `compose.yml`.

Likely include a "force search this turn" UI fallback for users on weak local models that don't reliably call tools.

### 6. Multi-user + admin panel
Invite flow, user management, role-gated settings. Now that auth exists from phase 2, this is mostly UI.

### 7. Polish
Responsive layout, keyboard shortcuts, error states, empty states, dark mode, copy-to-clipboard, edit/regenerate, etc. Resist adding new features until this pass is done.

## Explicit non-goals

- RAG / embeddings / vector stores
- Agent frameworks, workflow builders, "characters", prompt marketplaces
- Multi-provider abstraction beyond OpenAI-compatible (revisit later if needed)
- Built-in model hosting — users bring their own endpoint
