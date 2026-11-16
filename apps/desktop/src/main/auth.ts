import {
  CLIENT_HEADER,
  NATIVE_SIGN_IN_EXCHANGE_PATH,
  type NativeSignInExchange,
} from "@overtchat/shared";
import { app, net, session } from "electron";
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
 *
 * Main also identifies the app with {@link CLIENT_HEADER}. Headers added here
 * do not trigger CORS preflights, so servers older than the header accept them.
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
    if (url) headers[CLIENT_HEADER] = `desktop/${app.getVersion()}`;
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

/**
 * Trades the code a sign-in through the browser came back with for a session,
 * and keeps its token. False when the server no longer accepts the code.
 */
export async function exchangeSignInCode(
  serverOrigin: string,
  grant: NativeSignInExchange,
): Promise<boolean> {
  const response = await net.fetch(
    `${serverOrigin}/api/auth${NATIVE_SIGN_IN_EXCHANGE_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CLIENT_HEADER]: `desktop/${app.getVersion()}`,
      },
      body: JSON.stringify(grant),
    },
  );
  const token = response.headers.get("set-auth-token");
  // The server may have changed while the browser was away.
  if (!response.ok || !token || getServerOrigin() !== serverOrigin) return false;
  setSessionToken(token);
  return true;
}
