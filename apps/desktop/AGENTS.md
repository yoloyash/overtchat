# Desktop app guidance

This workspace is the Electron client for an operator-selected OvertChat
server. Its renderer bundles the web UI from `apps/web/spa` with Vite and serves
it at `overtchat://app`; the server is only an API. Validation is in
`docs/development.md#desktop-validation`.

## Boundaries

- The renderer is the web UI. Desktop-only UI is limited to the screens shown
  before it loads (`src/renderer`): connecting, and a saved server that can't
  run it. Anything else belongs in `apps/web`, behind the `DesktopBridge` in
  `packages/shared/src/desktop.ts` when it needs the shell.
- Web code must stay usable from another origin: request paths through
  `apiUrl`, and server-returned URLs through `serverUrl`.
- Main owns the server choice and the session. The UI's cookies would be
  third-party at `overtchat://app`, so `src/main/auth.ts` keeps Better Auth's
  bearer token, encrypted with `safeStorage`, and adds it to requests for the
  saved server. The renderer never sees it.
- A server must report the app's `CLIENT_API_LEVEL` from `/api/ping`. Older and
  newer servers get a blocking screen, never a degraded UI.
- Routes live in the URL hash, so the protocol handler serves only real files.

## Security

Windows are sandboxed with context isolation. IPC handlers accept only the main
window's frame at the app origin; check senders with `isAppSender`. Only the
main window gets the preload. Navigation away from the app origin opens in the
default browser, except server pages, which open in a window without preload.
