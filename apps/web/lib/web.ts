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
import type { FetchedPage, WebSearchOutput } from "./web-client";

export type { FetchedPage, WebSearchOutput, WebSearchResult } from "./web-client";
export { cleanDomain, faviconUrl } from "./web-client";

const BUNDLED_SEARXNG_URL = "http://searxng:8080";
const MAX_CONTENT_CHARS = 8_000;

type FetchedWebPage = FetchedPage & { kind: "text" };
export type FetchedWebResource = FetchedWebPage | FetchImageResult;

type SearchConfiguration = {
  braveApiKey?: string;
  searxngUrl?: string;
};

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
    const configuredSearxng = capability.baseUrl || process.env.SEARXNG_URL;
    const searxngUrl =
      configuredSearxng ||
      (capability.bundledInstalled ? BUNDLED_SEARXNG_URL : undefined);
    return {
      braveApiKey: capability.apiKey,
      searxngUrl,
    };
  }
  if (capability.provider === "bundled") {
    return {
      searxngUrl: BUNDLED_SEARXNG_URL,
    };
  }
  if (capability.provider === "searxng") {
    const baseUrl = capability.baseUrl || process.env.SEARXNG_URL;
    if (!baseUrl) throw new Error("SearXNG is not configured.");
    return {
      searxngUrl: baseUrl,
    };
  }
  throw new Error("The configured web search provider is not supported.");
}

function sameSearchConfiguration(
  left: SearchConfiguration,
  right: SearchConfiguration,
): boolean {
  return (
    left.braveApiKey === right.braveApiKey &&
    left.searxngUrl === right.searxngUrl
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

  const options: WebBasicsOptions = {
    searchBackend: "auto",
    allowKeylessFallback: true,
    braveApiKey: configuration.braveApiKey,
    searxngUrl: configuration.searxngUrl,
  };
  const client = createWebBasics(options);
  activeSearchClient = { configuration, client };
  return client;
}

export async function searchWeb(
  query: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<WebSearchOutput> {
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
  let result;
  try {
    result = await fetchUrl({
      url,
      startIndex: options.startIndex,
      maxLength: MAX_CONTENT_CHARS,
      signal: options.signal,
    });
  } catch (error) {
    throw fetchFailure(url, error);
  }

  return result.kind === "image" ? result : fetchedPage(result);
}

const REDDIT_HOST = /(^|\.)(reddit\.com|redd\.it)$/u;

/**
 * Reddit serves anonymous post feeds about once per minute per IP and Web
 * Basics reports the throttle as an HTTP 429 whose message ends with the
 * seconds to wait. Users and models both read tool errors verbatim, so the
 * server-side wording is replaced with a short instruction to wait.
 */
export function fetchFailure(url: string, error: unknown): unknown {
  if (!isRedditThrottle(url, error)) return error;
  const seconds = /retry after (\d+)s/u.exec(error.message)?.[1];
  const wait =
    seconds === undefined
      ? "Try again in about a minute."
      : `Try again in ${seconds} seconds.`;
  return new Error(`Reddit rate limited this server. ${wait}`);
}

function isRedditThrottle(url: string, error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if ((error as { status?: unknown }).status !== 429) return false;
  try {
    return REDDIT_HOST.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function fetchedPage(result: FetchTextResult): FetchedWebPage {
  return { ...result };
}
