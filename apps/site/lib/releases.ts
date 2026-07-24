export type ReleasePlatform = "web" | "mobile";

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  contentType: string;
  size: number;
}

export interface ProductRelease {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  platform: ReleasePlatform;
  assets: ReleaseAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function httpsUrlValue(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function classifyReleaseTag(tagName: string): ReleasePlatform | null {
  if (/^mobile-v\d/i.test(tagName)) return "mobile";
  if (/^v\d/i.test(tagName)) return "web";
  return null;
}

function normalizeAsset(value: unknown): ReleaseAsset | null {
  if (!isRecord(value)) return null;

  const name = stringValue(value.name);
  const downloadUrl = httpsUrlValue(value.browser_download_url);
  if (!name || !downloadUrl) return null;

  return {
    name,
    downloadUrl,
    contentType: stringValue(value.content_type) ?? "application/octet-stream",
    size:
      typeof value.size === "number" &&
      Number.isFinite(value.size) &&
      value.size >= 0
        ? value.size
        : 0,
  };
}

function normalizeRelease(value: unknown): ProductRelease | null {
  if (!isRecord(value) || value.draft === true || value.prerelease === true) {
    return null;
  }

  const tagName = stringValue(value.tag_name);
  if (!tagName) return null;

  const platform = classifyReleaseTag(tagName);
  if (!platform) return null;

  const publishedAt = stringValue(value.published_at);
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;

  const fallbackUrl = `https://github.com/yoloyash/overtchat/releases/tag/${encodeURIComponent(tagName)}`;
  const assets = Array.isArray(value.assets)
    ? value.assets
        .map(normalizeAsset)
        .filter((asset): asset is ReleaseAsset => asset !== null)
    : [];

  return {
    tagName,
    name: stringValue(value.name) ?? tagName,
    body: typeof value.body === "string" ? value.body : "",
    publishedAt,
    url: httpsUrlValue(value.html_url) ?? fallbackUrl,
    platform,
    assets,
  };
}

export function normalizeReleases(values: unknown[]): ProductRelease[] {
  return values
    .map(normalizeRelease)
    .filter((release): release is ProductRelease => release !== null)
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
    );
}
