import "server-only";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import type { WebSearchResult, FetchedPage } from "./web-client";

export type { WebSearchResult, FetchedPage } from "./web-client";
export { cleanDomain, faviconUrl } from "./web-client";

const MAX_CONTENT_CHARS = 8_000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10_000;

export async function searxngSearch(
  query: string,
  limit = 5,
): Promise<WebSearchResult[]> {
  const capability = getServerCapability("search");
  if (capability.provider === "disabled") {
    throw new Error("Web search is disabled on this server.");
  }
  if (capability.provider === "brave") {
    return braveSearch(query, limit, capability.apiKey);
  }
  const baseUrl =
    capability.provider === "bundled"
      ? "http://searxng:8080"
      : capability.baseUrl || process.env.SEARXNG_URL;
  if (!baseUrl) throw new Error("SearXNG is not configured.");
  const u = new URL("/search", baseUrl);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("safesearch", "1");
  u.searchParams.set("language", "all");

  const res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`searxng: ${res.status}`);

  const json = (await res.json()) as {
    results?: Array<{ url: string; title?: string; content?: string }>;
  };

  return (json.results ?? []).slice(0, limit).map((r) => ({
    link: r.url,
    title: r.title ?? r.url,
    snippet: r.content ?? "",
  }));
}

async function braveSearch(
  query: string,
  limit: number,
  apiKey: string | null,
): Promise<WebSearchResult[]> {
  if (!apiKey) throw new Error("The Brave Search API key is not configured.");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("safesearch", "moderate");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`brave search: ${response.status}`);
  const body = (await response.json()) as {
    web?: {
      results?: Array<{ url: string; title?: string; description?: string }>;
    };
  };
  return (body.web?.results ?? []).slice(0, limit).map((result) => ({
    link: result.url,
    title: result.title ?? result.url,
    snippet: result.description ?? "",
  }));
}

export async function fetchReadable(url: string): Promise<FetchedPage> {
  const { res, finalUrl } = await fetchSafe(url);
  if (!res.ok) throw new Error(`fetch: ${res.status}`);
  assertReadableContentType(res);
  const html = await readTextCapped(res);

  const { parseHTML } = await import("linkedom");
  const { Defuddle } = await import("defuddle/node");

  const { document } = parseHTML(html);
  const result = await Defuddle(document as unknown as Document, finalUrl, {
    markdown: true,
  });

  const content = (result.content ?? "").slice(0, MAX_CONTENT_CHARS);
  return {
    url: finalUrl,
    title: result.title ?? finalUrl,
    content,
    wordCount: result.wordCount ?? 0,
  };
}

async function fetchSafe(
  rawUrl: string,
  redirects = 0,
): Promise<{ res: Response; finalUrl: string }> {
  const url = await validatePublicHttpUrl(rawUrl);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "overtchat/0.1" },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (isRedirect(res.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("fetch: too many redirects");
    const location = res.headers.get("location");
    if (!location) throw new Error("fetch: redirect without location");
    return fetchSafe(new URL(location, url).toString(), redirects + 1);
  }

  return { res, finalUrl: url.toString() };
}

async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("fetch: invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("fetch: only http(s) URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("fetch: URLs with credentials are not supported");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("fetch: private hosts are not supported");
  }

  // TOCTOU: fetch() will re-resolve at connect time, so a rebinding-attacker
  // DNS server can return a public IP here and a private one to fetch().
  // Acceptable for v0.1 (self-hosted, small surface). Closing this requires
  // pinning the resolved IP via undici's connect hook — see the tracking
  // issue if/when this matters.
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(
    () => [],
  );
  if (records.length === 0) throw new Error("fetch: host could not be resolved");
  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("fetch: private addresses are not supported");
  }

  return url;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function assertReadableContentType(res: Response): void {
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType) return;
  if (
    contentType.startsWith("text/") ||
    contentType.includes("html") ||
    contentType.includes("xml")
  ) {
    return;
  }
  throw new Error(`fetch: unsupported content-type ${contentType}`);
}

async function readTextCapped(res: Response): Promise<string> {
  const declaredLength = Number(res.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_FETCH_BYTES) {
    throw new Error("fetch: response too large");
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error("fetch: response too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
