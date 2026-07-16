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

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const RELEASES_API = "https://api.github.com/repos/yoloyash/overtchat/releases";
const RELEASES_PER_PAGE = 100;
const MAX_PAGES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function classifyReleaseTag(tagName: string): ReleasePlatform | null {
  if (/^mobile-v\d/i.test(tagName)) return "mobile";
  if (/^v\d/i.test(tagName)) return "web";
  return null;
}

function normalizeAsset(value: unknown): ReleaseAsset | null {
  if (!isRecord(value)) return null;

  const name = stringValue(value.name);
  const downloadUrl = stringValue(value.browser_download_url);
  if (!name || !downloadUrl) return null;

  return {
    name,
    downloadUrl,
    contentType: stringValue(value.content_type) ?? "application/octet-stream",
    size: typeof value.size === "number" && value.size >= 0 ? value.size : 0,
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
    url: stringValue(value.html_url) ?? fallbackUrl,
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

export async function fetchGithubReleases(
  fetcher: Fetcher = fetch,
): Promise<ProductRelease[]> {
  const rawReleases: unknown[] = [];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "overtchat-project-site",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(RELEASES_API);
    url.searchParams.set("per_page", String(RELEASES_PER_PAGE));
    url.searchParams.set("page", String(page));

    const response = await fetcher(url, {
      headers,
      cache: "force-cache",
    });

    if (!response.ok) {
      throw new Error(
        `GitHub Releases request failed (${response.status} ${response.statusText})`,
      );
    }

    const pageData: unknown = await response.json();
    if (!Array.isArray(pageData)) {
      throw new Error("GitHub Releases returned an unexpected response shape");
    }

    rawReleases.push(...pageData);
    if (pageData.length < RELEASES_PER_PAGE) break;

    if (page === MAX_PAGES) {
      throw new Error("GitHub Releases pagination exceeded the safety limit");
    }
  }

  const releases = normalizeReleases(rawReleases);
  if (releases.length === 0) {
    throw new Error("No stable OvertChat releases were returned by GitHub");
  }

  return releases;
}
