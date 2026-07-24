const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const SITE_BASE_PATH =
  rawBasePath === "/" ? "" : rawBasePath.replace(/\/$/, "");
export const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://overtchat.com"
).replace(/\/$/, "");

export function sitePath(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_BASE_PATH}${normalizedPath}`;
}

export function absoluteSiteUrl(path = "/"): string {
  return new URL(sitePath(path), `${SITE_ORIGIN}/`).toString();
}
