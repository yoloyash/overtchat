export { cleanDomain, type WebSearchResult, type FetchedPage } from "@overtchat/shared";

export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
