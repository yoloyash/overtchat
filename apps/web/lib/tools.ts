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

/** Exhaustive registry names in deterministic provider order. */
export const CHAT_TOOL_ORDER = Object.freeze(
  Object.keys(chatTools) as Array<keyof typeof chatTools>,
);

/** Tools available when the user explicitly requests Search for one message. */
export const WEB_TOOL_NAMES = Object.freeze([
  "web_search",
  "fetch_url",
] satisfies Array<keyof typeof chatTools>);

/**
 * Stable output-format instruction. It stays in the system prefix whenever
 * the selected model supports tools, including one-shot Search requests.
 */
export const WEB_SEARCH_CITATION_PROMPT =
  "Use the available tools when they materially improve the answer. After web_search, cite supported claims with literal anchors such as \\ue202turn0search0. The number after turn is the zero-based web_search call number in this response; the final number is the zero-based result index within that call (for example, the fourth result from the second search is \\ue202turn1search3). Copy this syntax exactly without braces, and place anchors after punctuation. Do not use Markdown links or footnotes for these citations.";
