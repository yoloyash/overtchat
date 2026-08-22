import "server-only";
import {
  createWebBasics,
  fetchUrl,
  type FetchImageResult,
  type FetchTextResult,
  type WebBasics,
  type WebBasicsOptions,
} from "@yoloyash/web-basics";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import type { FetchedPage, WebSearchResult } from "./web-client";

export type { FetchedPage, WebSearchResult } from "./web-client";
export { cleanDomain, faviconUrl } from "./web-client";

const BUNDLED_SEARXNG_URL = "http://searxng:8080";
const MAX_CONTENT_CHARS = 8_000;

type FetchedWebPage = FetchedPage & { kind: "text" };
export type FetchedWebResource = FetchedWebPage | FetchImageResult;

type SearchConfiguration =
  | { provider: "brave"; apiKey: string }
  | { provider: "searxng"; baseUrl: string };

let activeSearchClient:
  | { configuration: SearchConfiguration; client: WebBasics }
  | undefined;

function configuredSearch(): SearchConfiguration {
  const capability = getServerCapability("search");
  if (capability.provider === "disabled") {
    throw new Error("Web search is disabled on this server.");
  }
  if (capability.provider === "brave") {
    if (!capability.apiKey) {
      throw new Error("The Brave Search API key is not configured.");
    }
    return { provider: "brave", apiKey: capability.apiKey };
  }
  if (capability.provider === "bundled") {
    return { provider: "searxng", baseUrl: BUNDLED_SEARXNG_URL };
  }
  if (capability.provider === "searxng") {
    const baseUrl = capability.baseUrl || process.env.SEARXNG_URL;
    if (!baseUrl) throw new Error("SearXNG is not configured.");
    return { provider: "searxng", baseUrl };
  }
  throw new Error("The configured web search provider is not supported.");
}

function sameSearchConfiguration(
  left: SearchConfiguration,
  right: SearchConfiguration,
): boolean {
  if (left.provider !== right.provider) return false;
  if (left.provider === "brave" && right.provider === "brave") {
    return left.apiKey === right.apiKey;
  }
  return (
    left.provider === "searxng" &&
    right.provider === "searxng" &&
    left.baseUrl === right.baseUrl
  );
}

function configuredSearchClient(): WebBasics {
  const configuration = configuredSearch();
  if (
    activeSearchClient &&
    sameSearchConfiguration(activeSearchClient.configuration, configuration)
  ) {
    return activeSearchClient.client;
  }

  const options: WebBasicsOptions =
    configuration.provider === "brave"
      ? { searchBackend: "brave", braveApiKey: configuration.apiKey }
      : { searchBackend: "searxng", searxngUrl: configuration.baseUrl };
  const client = createWebBasics(options);
  activeSearchClient = { configuration, client };
  return client;
}

export async function searchWeb(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  return configuredSearchClient().webSearch({
    query,
    limit,
    signal,
  });
}

export async function fetchReadable(
  url: string,
  options: { startIndex?: number; signal?: AbortSignal } = {},
): Promise<FetchedWebResource> {
  const result = await fetchUrl({
    url,
    startIndex: options.startIndex,
    maxLength: MAX_CONTENT_CHARS,
    signal: options.signal,
  });

  return result.kind === "image" ? result : fetchedPage(result);
}

function fetchedPage(result: FetchTextResult): FetchedWebPage {
  return { ...result };
}
