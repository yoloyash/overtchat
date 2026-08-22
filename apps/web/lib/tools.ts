import { tool } from "ai";
import { z } from "zod";
import type { FetchedImage, FetchedUrl } from "@overtchat/shared";

export interface WebToolOptions {
  userId: string;
  supportsImageInput: boolean;
}

export function createWebTools({
  userId,
  supportsImageInput,
}: WebToolOptions) {
  return Object.freeze({
    web_search: tool({
      description:
        "Search the web. Returns {link, title, snippet}. Cite sources.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, limit }, { abortSignal }) => {
        const { searchWeb } = await import("./web");
        return searchWeb(query, limit, abortSignal);
      },
    }),

    fetch_url: tool<
      { url: string; startIndex?: number },
      FetchedUrl,
      Record<string, never>
    >({
      description:
        supportsImageInput
          ? "Fetch a provided or discovered URL. Returns a chunk of readable text from pages, PDFs, and text files, or an image for visual inspection. When a text result has truncated=true, call again with the same URL and startIndex equal to nextStartIndex."
          : "Fetch a provided or discovered URL as a chunk of readable text from pages, PDFs, and text files. When a result has truncated=true, call again with the same URL and startIndex equal to nextStartIndex. The selected model cannot inspect image URLs.",
      inputSchema: z.object({
        url: z.string().url(),
        startIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Character offset returned as nextStartIndex by a prior fetch",
          ),
      }),
      execute: async ({ url, startIndex }, { abortSignal }) => {
        const { fetchReadable } = await import("./web");
        const result = await fetchReadable(url, {
          startIndex,
          signal: abortSignal,
        });
        if (result.kind === "text") return result;
        if (!supportsImageInput) {
          throw new Error("The selected model does not support image input.");
        }

        const { storeFetchedImage } = await import("@/lib/db/uploads");
        const filename = imageFilename(result.url, result.contentType);
        const { uploadUrl } = await storeFetchedImage({
          userId,
          filename,
          mediaType: result.contentType,
          data: result.data,
        });
        return {
          kind: "image" as const,
          url: result.url,
          uploadUrl,
          filename,
          contentType: result.contentType,
          byteLength: result.byteLength,
        } satisfies FetchedImage;
      },
      toModelOutput: async ({ output }) => {
        if (!isFetchedImage(output)) {
          return {
            type: "json",
            value: {
              kind: output.kind ?? "text",
              url: output.url,
              title: output.title,
              content: output.content,
              wordCount: output.wordCount,
              contentType: output.contentType,
              extractor: output.extractor,
              startIndex: output.startIndex,
              returnedChars: output.returnedChars,
              totalChars: output.totalChars,
              truncated: output.truncated,
              nextStartIndex: output.nextStartIndex,
              fallbackReason: output.fallbackReason,
              pageCount: output.pageCount,
              metadata: output.metadata,
              links: output.links,
            },
          };
        }
        if (!supportsImageInput) {
          return {
            type: "error-text",
            value: "The selected model does not support image input.",
          };
        }

        const { readFetchedImage } = await import("@/lib/db/uploads");
        const stored = await readFetchedImage(output.uploadUrl, userId);
        if (!stored) {
          return {
            type: "error-text",
            value: "The fetched image is no longer available.",
          };
        }
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: `Image fetched from ${output.url}. Inspect the attached image.`,
            },
            {
              type: "file",
              mediaType: stored.mediaType,
              filename: stored.filename,
              data: { type: "data", data: stored.data },
            },
          ],
        };
      },
    }),
  });
}

export type WebTools = ReturnType<typeof createWebTools>;

/** Exhaustive native-tool names in deterministic provider order. */
export const CHAT_TOOL_ORDER = Object.freeze([
  "web_search",
  "fetch_url",
] as const);

/** Tools available when the user explicitly requests Search for one message. */
export const WEB_TOOL_NAMES = CHAT_TOOL_ORDER;

function isFetchedImage(value: unknown): value is FetchedImage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Partial<FetchedImage>;
  return (
    image.kind === "image" &&
    typeof image.url === "string" &&
    typeof image.uploadUrl === "string" &&
    typeof image.filename === "string" &&
    typeof image.contentType === "string" &&
    typeof image.byteLength === "number"
  );
}

function imageFilename(url: string, contentType: string): string {
  let basename = "";
  try {
    const encoded = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    basename = encoded ? decodeURIComponent(encoded) : "";
  } catch {
    // The URL was already validated by Web Basics; use a stable fallback if
    // its final pathname still cannot be represented as a filename.
  }
  const sanitized = basename
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .slice(0, 180);
  if (sanitized) return sanitized;

  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "jpg";
  return `fetched-image.${extension}`;
}

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
