/**
 * Origin of the OvertChat server the UI talks to. Empty when that server also
 * serves the UI, so API paths stay same-origin.
 */
let apiOrigin = "";

/** Points API requests at another server. Bundled clients call this before rendering. */
export function setApiOrigin(origin: string) {
  apiOrigin = new URL(origin).origin;
}

/** The configured server origin, or an empty string when it serves the UI. */
export function getApiOrigin(): string {
  return apiOrigin;
}

/** Resolves an `/api/...` path against the configured server. */
export function apiUrl(path: string): string {
  return apiOrigin + path;
}

/**
 * Resolves a URL the server returned, like an upload's `/api/uploads/...`.
 * Absolute, `data:` and `blob:` URLs are returned unchanged.
 */
export function serverUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? apiUrl(url) : url;
}
