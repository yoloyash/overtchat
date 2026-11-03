/**
 * A short description of the client behind a user agent, like "Chrome on
 * macOS", for people deciding whether a sign-in is theirs.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = operatingSystem(ua);
  const client = clientName(ua);
  if (!client) return os ?? "Unknown device";
  return os ? `${client} on ${os}` : client;
}

function operatingSystem(ua: string): string | null {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  // React Native on iOS identifies as `<App>/<build> CFNetwork/<v> Darwin/<v>`.
  if (/CFNetwork\/.*Darwin\//.test(ua)) return "iOS";
  return null;
}

function clientName(ua: string): string | null {
  if (/Electron\//.test(ua)) return "OvertChat desktop app";
  if (/CFNetwork\//.test(ua) || /^okhttp\//.test(ua)) return "OvertChat app";
  if (/Edg(A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return null;
}
