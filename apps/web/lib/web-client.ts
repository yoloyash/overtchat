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

export function cleanDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
