import { net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "overtchat";
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const APP_URL = `${APP_ORIGIN}/`;

/** `URL.origin` is "null" for custom schemes like the app's, so build it from the parts. */
export function originOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return host ? `${protocol}//${host}` : null;
  } catch {
    return null;
  }
}

/** In development, electron-vite serves the renderer here. */
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const rendererDirectory = path.join(import.meta.dirname, "../renderer");

/**
 * The UI connects to whichever server the user chose, so its connections are
 * limited by scheme rather than host.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' http: https: ws: wss: blob: data:",
  "img-src 'self' http: https: blob: data:",
  "media-src 'self' http: https: blob: mediastream:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "form-action 'self'",
].join("; ");

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: !devServerUrl,
      },
    },
  ]);
}

function withPolicy(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Serves a file from the built renderer. Routes live in the URL hash. */
async function serveBuilt(pathname: string): Promise<Response> {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(rendererDirectory, relative);
  if (path.relative(rendererDirectory, file).startsWith("..")) {
    return new Response(null, { status: 404 });
  }
  const response = await net.fetch(pathToFileURL(file).href).catch(() => null);
  return response?.ok ? response : new Response(null, { status: 404 });
}

/** Headers the browser set for the app's own origin, which `net.fetch` rejects or would misreport. */
const BROWSER_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "connection",
  "content-length",
  "accept-encoding",
  "upgrade-insecure-requests",
]);

function proxiedHeaders(headers: Headers): Headers {
  const proxied = new Headers();
  for (const [name, value] of headers) {
    if (!BROWSER_HEADERS.has(name) && !name.startsWith("sec-fetch-")) proxied.set(name, value);
  }
  return proxied;
}

/** Serves the bundled UI at `overtchat://app`, from Vite in development. */
export function handleAppScheme(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response(null, { status: 404 });
    if (devServerUrl) {
      const target = new URL(`${url.pathname}${url.search}`, devServerUrl);
      return withPolicy(await net.fetch(target.href, { headers: proxiedHeaders(request.headers) }));
    }
    return withPolicy(await serveBuilt(url.pathname));
  });
}
