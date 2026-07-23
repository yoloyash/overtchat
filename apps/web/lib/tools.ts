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
  `Web search:
Use web tools only when the user's request requires current or likely-to-change information, or when they explicitly ask. Cite every non-obvious factual claim derived from web_search results.

Citation format:
Use these literal escape sequences exactly: \\ue202 before each citation anchor, \\ue200 and \\ue201 around a citation group, and \\ue203 and \\ue204 around highlighted cited text.

An anchor is \\ue202turnNsearchI, where N is the zero-based web_search call in the current response and I is the zero-based result index within that call. Replace N and I with digits; do not output braces.

Examples:
- Single: "Statement.\\ue202turn0search0"
- Multiple: "Statement.\\ue202turn0search0\\ue202turn0search1"
- Group: "Statement. \\ue200\\ue202turn0search0\\ue202turn0search1\\ue201"
- Highlight: "\\ue203Cited text.\\ue204\\ue202turn0search0"
- Fourth result from the second search: "Statement.\\ue202turn1search3"

Place anchors after punctuation. Do not use Markdown links, footnotes, or HTML tags for web_search citations.`;
