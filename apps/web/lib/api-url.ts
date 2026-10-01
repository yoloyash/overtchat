/**
 * Origin of the OvertChat server the UI talks to. Empty when that server also
 * serves the UI, so API paths stay same-origin.
 */
let apiOrigin = "";

/** Points API requests at another server. Bundled clients call this before rendering. */
export function setApiOrigin(origin: string) {
  apiOrigin = new URL(origin).origin;
}

/** Resolves an `/api/...` path against the configured server. */
export function apiUrl(path: string): string {
  return apiOrigin + path;
}
