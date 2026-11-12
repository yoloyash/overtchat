import type { BetterAuthClientPlugin } from "better-auth/client";

export const UNEXPECTED_SESSION_RESPONSE = "UNEXPECTED_SESSION_RESPONSE";
const UNEXPECTED_SESSION_MESSAGE =
  "The server didn't answer like OvertChat. A proxy or Wi-Fi sign-in page may be in the way.";

// The message for a session check this guard rejected, read from the session
// error that Better Auth keeps.
export function unexpectedSessionMessage(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNEXPECTED_SESSION_RESPONSE
    ? UNEXPECTED_SESSION_MESSAGE
    : null;
}

function hasId(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

// The server answers a session check with null when signed out, or with the
// session and its user.
export function isSessionPayload(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const { session, user } = value as { session?: unknown; user?: unknown };
  if (session === null && user === null) return true;
  return hasId(session) && hasId(user);
}

function isSessionCheck(url: unknown): boolean {
  try {
    return new URL(String(url)).pathname.endsWith("/get-session");
  } catch {
    return false;
  }
}

// A proxy login page, captive portal, or wrong server can answer the session
// check with 200 and a page of HTML. Better Auth would store that page as the
// session. Turn it into a failed check instead, so the last good session stays
// in place exactly as it does when the server can't be reached.
export function sessionResponseGuard() {
  return {
    id: "session-response-guard",
    fetchPlugins: [
      {
        id: "session-response-guard",
        name: "Session response guard",
        hooks: {
          async onResponse({ response, request }) {
            if (!response.ok || !isSessionCheck(request.url)) return;
            let body: unknown;
            try {
              body = JSON.parse(await response.clone().text());
            } catch {
              body = undefined;
            }
            if (isSessionPayload(body)) return;
            return new Response(
              JSON.stringify({
                code: UNEXPECTED_SESSION_RESPONSE,
                message: UNEXPECTED_SESSION_MESSAGE,
              }),
              {
                status: 502,
                statusText: "Bad Gateway",
                headers: { "content-type": "application/json" },
              },
            );
          },
        },
      },
    ],
  } satisfies BetterAuthClientPlugin;
}
