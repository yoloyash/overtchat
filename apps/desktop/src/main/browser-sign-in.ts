import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  DESKTOP_SIGN_IN_REDIRECT_PATH,
  desktopSignInRedirect,
  nativeSignInStartUrl,
  readNativeSignInRedirect,
  type NativeSignInExchange,
} from "@overtchat/shared";
import type { DesktopSignInResult } from "@overtchat/shared/desktop";

/** The server gives the browser this long to finish at the provider. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export interface BrowserSignIn {
  serverOrigin: string;
  /** Opens the address in the user's default browser. */
  openBrowser(url: string): void | Promise<void>;
  /** Trades the code for a session and keeps it; false when the server refuses. */
  exchange(grant: NativeSignInExchange): Promise<boolean>;
  timeoutMs?: number;
}

function page(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OvertChat</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 24rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.7; }
</style>
</head>
<body><main><h1>${title}</h1><p>${detail}</p></main></body>
</html>`;
}

const SIGNED_IN = page(
  "You're signed in",
  "You can close this tab and go back to OvertChat.",
);
const NOT_SIGNED_IN = page(
  "Sign-in didn't finish",
  "Go back to OvertChat to see what happened and try again.",
);

let cancelCurrent: (() => void) | null = null;

/**
 * Signs in through the system browser; see `@overtchat/shared/sign-in`. The
 * browser comes back to a port this listens on, on this machine only, for
 * just as long as the sign-in takes. Starting again abandons the one before.
 */
export function signInWithBrowser({
  serverOrigin,
  openBrowser,
  exchange,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
}: BrowserSignIn): Promise<DesktopSignInResult> {
  cancelCurrent?.();
  const codeVerifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("base64url");

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DesktopSignInResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cancelCurrent === cancel) cancelCurrent = null;
      // Let the browser's page finish loading before the port goes away.
      server.close();
      setTimeout(() => server.closeAllConnections(), 1_000).unref();
      resolve(result);
    };
    const cancel = () => finish({ ok: false, error: "access_denied" });
    const timer = setTimeout(() => finish({ ok: false, error: "expired" }), timeoutMs);
    timer.unref();

    const server = http.createServer((req, res) => {
      const respond = (status: number, body: string) => {
        res.writeHead(status, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close",
        });
        res.end(body);
      };
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const result =
        req.method === "GET" && url.pathname === DESKTOP_SIGN_IN_REDIRECT_PATH
          ? readNativeSignInRedirect(url.toString(), state)
          : null;
      // Anything else on this machine can reach the port; only the redirect
      // for this sign-in means something.
      if (!result || settled) return respond(404, NOT_SIGNED_IN);
      if ("error" in result) {
        respond(200, NOT_SIGNED_IN);
        return finish({ ok: false, error: result.error });
      }
      exchange({ code: result.code, codeVerifier }).then(
        (signedIn) => {
          respond(200, signedIn ? SIGNED_IN : NOT_SIGNED_IN);
          finish(signedIn ? { ok: true } : { ok: false, error: "expired" });
        },
        () => {
          respond(200, NOT_SIGNED_IN);
          finish({ ok: false, error: "sign_in_failed" });
        },
      );
    });
    server.on("error", () => finish({ ok: false, error: "sign_in_failed" }));
    cancelCurrent = cancel;

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const url = nativeSignInStartUrl(serverOrigin, {
        redirectUri: desktopSignInRedirect(port),
        codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
        state,
      });
      Promise.resolve()
        .then(() => openBrowser(url))
        .catch(() => finish({ ok: false, error: "sign_in_failed" }));
    });
  });
}
