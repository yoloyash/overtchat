import type { VoiceToolDefinition } from "@overtchat/shared";

export const VOICE_WEB_SEARCH_PROMPT = `Web search in a voice conversation:
Use web tools only when the user's request requires current or likely-to-change information, or when they explicitly ask. After searching, attribute important facts naturally by naming the source in the spoken answer.

Do not emit citation markers, internal reference IDs such as turn0search0, raw URLs, Markdown links, footnotes, or HTML. The voice interface displays the underlying source links separately.`;

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
