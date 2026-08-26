export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export interface ToolStatePart {
  state?: string;
}

export interface WebSearchResult {
  link: string;
  title: string;
  snippet: string;
}

export type WebSearchProvider =
  | "brave"
  | "duckduckgo"
  | "exa"
  | "firecrawl"
  | "none"
  | "searxng";

const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  brave: "Brave",
  duckduckgo: "DuckDuckGo",
  exa: "Exa",
  firecrawl: "Firecrawl",
  none: "No provider",
  searxng: "SearXNG",
};

export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  ageSeconds?: number;
  author?: string;
}

export interface WebSearchOutput {
  provider: WebSearchProvider;
  answer?: string;
  sources: WebSearchSource[];
  citations?: Array<{ url: string; title: string; citedText?: string }>;
  searchQueries?: string[];
  relatedQuestions?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    searchRequests?: number;
    totalTokens?: number;
  };
  model?: string;
  requestId?: string;
  authMode?: string;
}

export type PersistedWebSearchOutput = WebSearchOutput | WebSearchResult[];

export function webSearchResults(
  output: PersistedWebSearchOutput | undefined,
): WebSearchResult[] {
  if (!output) return [];
  if (Array.isArray(output)) return output;
  return output.sources.map((source) => ({
    link: source.url,
    title: source.title,
    snippet: source.snippet ?? "",
  }));
}

export function webSearchProviderLabel(
  output: PersistedWebSearchOutput | undefined,
): string | undefined {
  if (!output || Array.isArray(output)) return undefined;
  return WEB_SEARCH_PROVIDER_LABELS[output.provider];
}

export interface FetchedPage {
  kind?: "text";
  url: string;
  title: string;
  content: string;
  wordCount: number;
  contentType?: string;
  extractor?: string;
  startIndex?: number;
  returnedChars?: number;
  totalChars?: number;
  truncated?: boolean;
  nextStartIndex?: number;
  fallbackReason?: string;
  pageCount?: number;
  metadata?: Record<string, string | number | boolean | null>;
  links?: string[];
}

export interface FetchedImage {
  kind: "image";
  url: string;
  uploadUrl: string;
  filename: string;
  contentType: string;
  byteLength: number;
}

export type FetchedUrl = FetchedPage | FetchedImage;

export type WebSearchPart = {
  type: "tool-web_search";
  toolCallId: string;
  state: ToolState;
  input?: { query?: string; limit?: number };
  output?: PersistedWebSearchOutput;
  errorText?: string;
};

export type FetchUrlPart = {
  type: "tool-fetch_url";
  toolCallId: string;
  state: ToolState;
  input?: { url?: string; startIndex?: number };
  output?: FetchedUrl;
  errorText?: string;
};

export function isToolSettled(part: ToolStatePart): boolean {
  return (
    part.state === "output-available" ||
    part.state === "output-error"
  );
}

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
