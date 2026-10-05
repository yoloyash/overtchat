import { CLIENT_API_LEVEL, type PingResponse } from "@overtchat/shared";
import type { ServerProblem } from "../shared/ipc";

const PING_TIMEOUT_MS = 8_000;

export type PingResult =
  | { ok: true; version: string | null; apiLevel: number; problem: ServerProblem | null }
  | { ok: false; message: string };

/**
 * Turns a typed address into a server origin. Like the mobile app, an address
 * without a scheme means `http://`.
 */
export function serverOrigin(address: string): string | null {
  const value = address.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.origin;
}

export function displayHost(origin: string): string {
  return new URL(origin).host;
}

/** Whether a server built for another API level can run this app's UI. */
function compatibility(body: Partial<PingResponse>): ServerProblem | null {
  const version = typeof body.version === "string" ? body.version : null;
  const level = typeof body.apiLevel === "number" ? body.apiLevel : 0;
  if (level < CLIENT_API_LEVEL) return { kind: "server-outdated", version };
  if (level > CLIENT_API_LEVEL) return { kind: "app-outdated", version };
  return null;
}

/** Checks that an origin is an OvertChat server this app can use. */
export async function probeServer(
  origin: string,
  request: (input: string, init?: RequestInit) => Promise<Response>,
  options: { timeoutMs?: number; redirect?: RequestRedirect } = {},
): Promise<PingResult> {
  const host = displayHost(origin);
  let response: Response;
  try {
    response = await request(`${origin}/api/ping`, {
      cache: "no-store",
      redirect: options.redirect,
      signal: AbortSignal.timeout(options.timeoutMs ?? PING_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (/CERT|SSL/i.test(reason)) {
      return { ok: false, message: `${host} uses a certificate this computer doesn't trust.` };
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, message: `${host} took too long to respond.` };
    }
    return {
      ok: false,
      message: `Nothing answered at ${host}. Check the address and that the server is running.`,
    };
  }
  const body = (await response.json().catch(() => null)) as Partial<PingResponse> | null;
  if (!response.ok || body?.name !== "overtchat") {
    return { ok: false, message: `${host} responded, but it isn't an OvertChat server.` };
  }
  return {
    ok: true,
    version: typeof body.version === "string" ? body.version : null,
    apiLevel: Number.isSafeInteger(body.apiLevel) && body.apiLevel! > 0 ? body.apiLevel! : 0,
    problem: compatibility(body),
  };
}
