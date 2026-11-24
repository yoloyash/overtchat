# Mobile app guidance

This workspace is the Expo/React Native client for an operator-selected
OvertChat server. Run Expo interactively from `apps/mobile`; native module
changes require rebuilding the development client.

## Product boundary

The server URL is selected at runtime and stored on the device. Mobile supports
account settings and server administration through authenticated APIs. Server
installation and first-user signup remain outside the native app.
Advanced MCP and agent workspace setup can open the matching web settings page.

## Architecture

- `src/app/_layout.tsx` owns root providers and protected routing between server
  selection, login, and authenticated routes. At launch it keeps the splash
  screen up until the session is known (`src/lib/auth/launch.ts`), so a
  signed-in user never sees the login screen; after that the screens stay
  mounted through every session check.
- `src/app/(authed)/_layout.tsx` owns the active chat session and authenticated
  navigation stack. The drawer selects chats and projects through
  `src/lib/chat/session.ts`.
- `src/app/(authed)/settings` owns the settings stack. Admin destinations use
  `AdminGate`; server APIs independently enforce authorization. Keep credentials
  out of persisted caches and preserve settings scope (device, account, server).
- `src/lib/server-url.ts` owns the selected server. `src/lib/auth/client.ts`
  creates the Better Auth client for that server, and `src/lib/api.ts` is the
  authenticated HTTP boundary.
- The chat screen first hydrates persisted messages through React Query, then
  runs the AI SDK `useChat` transport for streaming. Chat completion invalidates
  the shared chat and message query keys.
- Server-state hooks live under `src/lib/queries`; reusable keys are defined
  only in `src/lib/queries/keys.ts`.
- Chat rendering and input behavior live under `src/components/chat`; the
  drawer and its project/chat mutations live under `src/components/drawer`.
- `MarkdownBody` draws replies, reasoning, documents and agent messages with
  `react-native-enriched-markdown`, which lays Markdown out in native text
  views and highlights fenced code natively. `CodeBlock` fences code that comes
  from outside a reply for the same renderer. Keep the props it passes
  (`markdownStyle`, `renderers`, handlers) at one identity between updates, or
  the native view restyles the whole message on every streamed chunk. A file a
  run returned replaces an image, or a line that is only its link, through
  `renderers`.
- The drawer has two halves, Chat and Agents, switched by a toggle that
  administrators see; `src/lib/agents/sidebarMode.ts` derives the half from
  the open route and remembers where each was left. The Agents half
  (`src/components/drawer/AgentsDrawer.tsx`) lists every session grouped by
  what it needs or by folder, with the state derived by
  `@overtchat/shared/agent-attention`, which the web sidebar shares. Agent
  conversations are drawer destinations at `(drawer)/agent/[id]`;
  `src/app/(authed)/(drawer)/agents` is the Agents stack: the new-session
  home with machine, folder and agent pickers, history, and a folder. Agent
  transcripts, settings, and interaction sheets live in
  `src/components/agents`; authenticated queries and commands live in
  `src/lib/queries/agents.ts`.
- Mobile does not expose workspace file browsing. Tool command, change, and
  output details use `AgentToolDetails`; these are supplied by the agent and do
  not fetch workspace files. Approval actions preserve provider response values.
- `AgentTranscript` is an inverted `FlatList`, so offset 0 is the newest
  content. Keep its `maintainVisibleContentPosition` constant: iOS reapplies
  the anchor from the last update made with it enabled. Following the newest
  content and holding an expanded row in place are handled in the component.
- `src/lib/agents/stream.ts` owns the foreground SSE lifecycle. Use bridge
  replicas for cursor/epoch reconciliation, abort subscriptions while away,
  and reconcile before reconnecting. Never automatically retry agent commands.
  Hermes copies strings on slice and concatenation, so parsing must stay
  linear in the bytes received; per-line buffer copies froze the JS thread on
  large bursts.
  Drafts and unresolved message identities are scoped to server, user, and
  session in `src/lib/agents/drafts.ts`.

## Platform constraints

Better Auth stores the mobile cookie in SecureStore. Use `authFetch` for
authenticated requests; cookie reads are asynchronous. Authentication upgrade
and native validation are documented in
`docs/development.md#authentication-upgrade-validation`. Changing servers must
also reset the cached auth client.

`src/polyfills.js` must load before the AI SDK streaming stack. Test streaming
on both Android and iOS after changing the transport or its polyfills.

Do not build highlighted code from one `<Text>` per token: Android lays out a
text view in time quadratic in its styled fragments, which froze the app on
blocks of a few hundred lines. The `enriched-markdown` block in `package.json`
selects the renderer's native features; `npm ci` downloads its highlight
grammars in a postinstall step that needs the npm registry and github.com, and
a change to the block takes effect on the next native build.

The React Compiler is on (`experiments.reactCompiler`) and memoizes components
and hooks, but it silently skips one whose code breaks a rule it relies on: a
ref read or written while rendering, `try` with `finally`, a hook reached
through a call such as `getAuthClient().useSession()` (use `useAuthSession`).
A skipped component gives its children new callbacks and objects on every
render. `src/reactCompilerCoverage.test.ts` fails when a file outside its known
list is skipped; fix the code instead of adding to the list. A streamed update
replaces every part of the message being written with a new object, so rows
drawn from parts compare them by content (`src/lib/equal.ts`), and handlers
passed to memoized children go through `useStableEvent`.

Navigation headers and safe-area behavior are owned by Expo Router. Android
drawer behavior currently relies on `predictiveBackGestureEnabled: false` in
`app.json`; test gestures and system-bar insets before changing navigation.

Use `@/*` for `src` imports and `@overtchat/shared/theme.rn` for shared theme
tokens. Run the mobile typecheck before finishing.
Agent transport and command changes also require `npm run test -w apps/mobile --`.
See `docs/development.md` for development validation and `docs/deploy.md#mobile`
for Android and iOS installation.
