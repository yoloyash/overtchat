import { isIP } from "node:net";
import { CLIENT_API_LEVEL, type PingResponse } from "@overtchat/shared";
import type { ServerProblem } from "../shared/ipc";

const PING_TIMEOUT_MS = 8_000;

export type PingResult =
  | { ok: true; origin: string; version: string | null; apiLevel: number; problem: ServerProblem | null }
  | { ok: false; message: string };

export interface PingOptions {
  timeoutMs?: number;
  redirect?: RequestRedirect;
}

export type ServerProbe = (origin: string, options?: PingOptions) => Promise<PingResult>;

/**
 * Public hostnames default to HTTPS. Local names and IP addresses retain HTTP
 * for self-hosted installations; an explicit scheme always takes precedence.
 */
export function serverOrigin(address: string): string | null {
  const value = address.trim();
  if (!value || /\s/.test(value)) return null;
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const withScheme = explicitScheme ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!explicitScheme && (isIP(hostname) || !hostname.includes(".") ||
    /\.(localhost|local|lan|home\.arpa)$/.test(hostname))) {
    url = new URL(`http://${value}`);
  }
  return url.origin;
}

export function displayHost(origin: string): string {
  return new URL(origin).host;
}

/** Whether a server built for another API level can run this app's UI. */
function compatibility(version: string | null, level: number): ServerProblem | null {
  if (level < CLIENT_API_LEVEL) return { kind: "server-outdated", version };
  if (level > CLIENT_API_LEVEL) return { kind: "app-outdated", version };
  return null;
}

/** Checks that an origin is an OvertChat server this app can use. */
export async function probeServer(
  origin: string,
  request: (input: string, init?: RequestInit) => Promise<Response>,
  options: PingOptions = {},
): Promise<PingResult> {
  const host = displayHost(origin);
  const signal = AbortSignal.timeout(options.timeoutMs ?? PING_TIMEOUT_MS);
  let response: Response;
  let body: Partial<PingResponse> | null;
  try {
    response = await request(`${origin}/api/ping`, {
      cache: "no-store",
      redirect: options.redirect,
      signal,
    });
    try {
      body = await response.json() as Partial<PingResponse> | null;
    } catch (error) {
      if (signal.aborted) throw error;
      body = null;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (/CERT|SSL/i.test(reason)) {
      return { ok: false, message: `${host} uses a certificate this computer doesn't trust.` };
    }
    if (signal.aborted) {
      return { ok: false, message: `${host} took too long to respond.` };
    }
    return {
      ok: false,
      message: `Nothing answered at ${host}. Check the address and that the server is running.`,
    };
  }
  if (!response.ok || body?.name !== "overtchat") {
    return { ok: false, message: `${host} responded, but it isn't an OvertChat server.` };
  }
  const destination = new URL(response.url || `${origin}/api/ping`);
  const requested = new URL(origin);
  const sameOrigin = destination.origin === requested.origin;
  const secureUpgrade = requested.protocol === "http:" && destination.protocol === "https:" &&
    destination.hostname === requested.hostname;
  // A successful native ping can follow a redirect that browser API requests
  // cannot. Retain a same-host HTTPS upgrade, but require explicit selection
  // for another host, a downgrade, or a server mounted below a path.
  if ((!sameOrigin && !secureUpgrade) || destination.username || destination.password ||
    destination.pathname !== "/api/ping" || destination.search || destination.hash) {
    return { ok: false, message: `${host} redirected to another address. Enter the server's final URL directly.` };
  }
  const version = typeof body.version === "string" ? body.version : null;
  const apiLevel = Number.isSafeInteger(body.apiLevel) && body.apiLevel! > 0 ? body.apiLevel! : 0;
  return {
    ok: true,
    origin: destination.origin,
    version,
    apiLevel,
    problem: compatibility(version, apiLevel),
  };
}
