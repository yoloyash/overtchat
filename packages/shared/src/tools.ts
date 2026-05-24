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
