import { tool } from "ai";
import { z } from "zod";
import { searxngSearch, fetchReadable } from "./web";

export const webTools = {
  web_search: tool({
    description:
      "Search the web via SearXNG. Returns a ranked list of {link, title, snippet}. " +
      "Call this first for any query that needs current information, then use fetch_url " +
      "on the most promising results to read the full page. Always cite sources.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Max number of results to return"),
    }),
    execute: async ({ query, limit }) => searxngSearch(query, limit),
  }),

  fetch_url: tool({
    description:
      "Fetch a URL and return its main content as markdown. Use this after web_search " +
      "to read specific pages in depth. Content is truncated to ~8k characters.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to fetch"),
    }),
    execute: async ({ url }) => fetchReadable(url),
  }),
};
