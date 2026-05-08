export interface WebSearchResult {
  link: string;
  title: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  wordCount: number;
}

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8088";
const MAX_CONTENT_CHARS = 8_000;
const FETCH_TIMEOUT_MS = 10_000;

export async function searxngSearch(
  query: string,
  limit = 5,
): Promise<WebSearchResult[]> {
  const u = new URL("/search", SEARXNG_URL);
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

export async function fetchReadable(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    headers: { "User-Agent": "overtchat/0.1" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`fetch: ${res.status}`);
  const html = await res.text();

  const { parseHTML } = await import("linkedom");
  const { Defuddle } = await import("defuddle/node");

  const { document } = parseHTML(html);
  const result = await Defuddle(document as unknown as Document, url, {
    markdown: true,
  });

  const content = (result.content ?? "").slice(0, MAX_CONTENT_CHARS);
  return {
    url,
    title: result.title ?? url,
    content,
    wordCount: result.wordCount ?? 0,
  };
}
