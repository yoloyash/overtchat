/** The chat a path shows, when it shows one. */
export function chatIdOfPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
