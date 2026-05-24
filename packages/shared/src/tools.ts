export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

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

export type WebSearchPart = {
  type: "tool-web_search";
  toolCallId: string;
  state: ToolState;
  input?: { query?: string; limit?: number };
  output?: WebSearchResult[];
  errorText?: string;
};

export type FetchUrlPart = {
  type: "tool-fetch_url";
  toolCallId: string;
  state: ToolState;
  input?: { url?: string };
  output?: FetchedPage;
  errorText?: string;
};

export function cleanDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

/**
 * Title-cased second-level-domain of a URL — for citation pills and the
 * Sources footer. e.g. reddit.com → "Reddit", news.ycombinator.com →
 * "Ycombinator". Falls back to the raw domain on parse error.
 */
export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

export function brandName(url: string): string {
  const domain = cleanDomain(url);
  const parts = domain.split(".");
  const sld = parts.length >= 2 ? parts[parts.length - 2] : domain;
  if (!sld) return domain;
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}
