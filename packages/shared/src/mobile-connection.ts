/** A connection QR contains only a server's HTTP(S) origin, never credentials. */
export function parseMobileServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (
    !/^https?:\/\//i.test(value) ||
    value.length > 2048 ||
    /[\s\\]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/*$/.test(url.pathname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLocalOnlyServer(origin: string): boolean {
  const host = new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "[::]" ||
    host === "0.0.0.0" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}
