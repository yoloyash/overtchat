import { tool } from "ai";
import { z } from "zod";
import { searxngSearch, fetchReadable } from "./web";

export const webTools = {
  web_search: tool({
    description:
      "Search the web. Returns {link, title, snippet}. Cite sources.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, limit }) => searxngSearch(query, limit),
  }),

  fetch_url: tool({
    description:
      "Fetch a provided or discovered URL as markdown (~8k chars) when its contents are needed.",
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }) => fetchReadable(url),
  }),
};

/** Full stable registry sent to every tool-capable model request. */
export const chatTools = Object.freeze({
  ...webTools,
});

/** Exhaustive registry names, also used as deterministic provider ordering. */
export const CHAT_TOOL_NAMES = Object.freeze(
  Object.keys(chatTools) as Array<keyof typeof chatTools>,
);
export const CHAT_TOOL_ORDER = CHAT_TOOL_NAMES;

/** Tools controlled by the user's Web Search toggle. */
export const WEB_TOOL_NAMES: ReadonlySet<keyof typeof chatTools> = new Set([
  "web_search",
  "fetch_url",
]);

/**
 * Stable output-format instruction. It stays in the system prefix whenever
 * the selected model supports tools, regardless of the current toggle state.
 */
export const WEB_SEARCH_CITATION_PROMPT =
  "After web_search, cite claims as literal \\ue202turn0search{index}, with index zero-based across all returned results. Do not use Markdown links or footnotes.";
