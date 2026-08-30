import type { VoiceToolDefinition } from "@overtchat/shared";

export const VOICE_WEB_SEARCH_PROMPT =
  "Web search is available when useful. Name important sources naturally, and do not read URLs aloud.";

export const VOICE_WEB_TOOLS: VoiceToolDefinition[] = [
  {
    type: "function",
    name: "web_search",
    description:
      "Search the web for current or likely-to-change information. Returns sources that should be named in the spoken answer.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "fetch_url",
    description:
      "Read a web page discovered through search. If the result is truncated, call again with nextStartIndex.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        startIndex: { type: "integer", minimum: 0 },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];
