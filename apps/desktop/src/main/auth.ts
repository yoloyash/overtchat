import { session } from "electron";
import { getServerOrigin, getSessionToken, setSessionToken } from "./settings";
import { needsTwoFactorCookie, pendingTwoFactorCookie } from "./two-factor-cookie";

/** Every request the UI makes to the server, including images, media and sockets. */
const SERVER_REQUESTS = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] };

function fromServer(url: string): URL | null {
  const origin = getServerOrigin();
  if (!origin) return null;
  try {
    const parsed = new URL(url.replace(/^ws/, "http"));
    return parsed.origin === origin ? parsed : null;
  } catch {
    return null;
  }
}

/** A sign-in waiting for its two-factor code; it lives for minutes, so memory is enough. */
let pendingTwoFactor: string | null = null;

function header(headers: Record<string, string | string[]> | undefined, name: string) {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  if (!entry) return undefined;
  return Array.isArray(entry[1]) ? entry[1][0] : entry[1];
}

/**
 * Signs the UI's server requests in. The UI runs at `overtchat://app`, so the
 * server's cookies are third-party there. Better Auth's bearer plugin returns
 * the session token in `set-auth-token`; main keeps it and sends it as
 * `Authorization` on every request to the server. A sign-in waiting for its
 * two-factor code is the one exception that needs a cookie.
 */
export function configureServerAuth(): void {
  const { webRequest } = session.defaultSession;

  webRequest.onBeforeSendHeaders(SERVER_REQUESTS, (details, callback) => {
    const token = getSessionToken();
    const headers = details.requestHeaders;
    const url = fromServer(details.url);
    if (token && url && !header(headers, "authorization")) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (pendingTwoFactor && url && needsTwoFactorCookie(url.pathname)) {
      const key = Object.keys(headers).find((name) => name.toLowerCase() === "cookie") ?? "Cookie";
      headers[key] = headers[key] ? `${headers[key]}; ${pendingTwoFactor}` : pendingTwoFactor;
    }
    callback({ requestHeaders: headers });
  });

  webRequest.onHeadersReceived(SERVER_REQUESTS, (details, callback) => {
    const url = fromServer(details.url);
    if (url) {
      const setCookies = Object.entries(details.responseHeaders ?? {})
        .filter(([key]) => key.toLowerCase() === "set-cookie")
        .flatMap(([, value]) => value);
      const pending = pendingTwoFactorCookie(setCookies);
      if (pending !== undefined) pendingTwoFactor = pending;
      const token = header(details.responseHeaders, "set-auth-token");
      if (token) setSessionToken(token);
      else if (url.pathname === "/api/auth/sign-out" && details.statusCode < 400) {
        setSessionToken(null);
      }
    }
    callback({});
  });
}
