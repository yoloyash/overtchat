# Mobile app guidance

This workspace is the Expo/React Native client for an operator-selected
OvertChat server. Run Expo interactively from `apps/mobile`; native module
changes require rebuilding the development client.

## Product boundary

The server URL is selected at runtime and stored on the device. Mobile does not
implement server setup, first-user signup, or administration; those flows remain
in the web app.

## Architecture

- `src/app/_layout.tsx` owns root providers and protected routing between server
  selection, login, and authenticated routes.
- `src/app/(authed)/_layout.tsx` owns the active chat session and authenticated
  navigation stack. The drawer selects chats and projects through
  `src/lib/chat/session.ts`.
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

## Platform constraints

Better Auth stores the mobile cookie in SecureStore. Use `authFetch` for
authenticated requests; uploads must attach `getAuthCookie()` to the
`expo/fetch` multipart request explicitly. Changing servers must also reset the
cached auth client.

`src/polyfills.js` must load before the AI SDK streaming stack. Test streaming
on both Android and iOS after changing the transport or its polyfills.

Navigation headers and safe-area behavior are owned by Expo Router. Android
drawer behavior currently relies on `predictiveBackGestureEnabled: false` in
`app.json`; test gestures and system-bar insets before changing navigation.

Use `@/*` for `src` imports and `@overtchat/shared/theme.rn` for shared theme
tokens. Run the mobile typecheck before finishing.
