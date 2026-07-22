/**
 * Citation Regex Patterns (based on LibreChat client/src/utils/citations.ts)
 *
 * These patterns handle two formats that LLMs may output:
 * 1. Literal escape sequences: "\\ue202turn0search0" (6 ASCII characters
 *    for the marker)
 * 2. Actual Unicode characters: "turn0search0" (U+E202 = 1 private-use
 *    character)
 *
 * The system instructs LLMs to output literal escape sequences, but some models
 * may convert them to actual Unicode characters during text generation. These
 * dual-format patterns ensure robust citation handling regardless of output format.
 *
 * Citation Format:
 * -  / U+E202: Standalone citation marker (before each anchor)
 * -  / U+E200: Composite group start
 * -  / U+E201: Composite group end
 * -  / U+E203: Highlight span start
 * -  / U+E204: Highlight span end
 *
 * Anchor Pattern: turn{N}{type}{index}
 * - N: Turn number (0-based)
 * - type: search|image|news|video|ref|file
 * - index: Result index within that type (0-based)
 */

import type { WebSearchPart, WebSearchResult } from "./tools";

export const SPAN_REGEX = /((?:\\ue203|).*?(?:\\ue204|))/g;

export const COMPOSITE_REGEX = /((?:\\ue200|).*?(?:\\ue201|))/g;

export const STANDALONE_PATTERN =
  /(?:\\ue202|)turn\{?(\d+)\}?(search|image|news|video|ref|file)\{?(\d+)\}?/g;

export const CLEANUP_REGEX =
  /\\ue200|\\ue201|\\ue202|\\ue203|\\ue204|\\ue206||||||/g;

export const INVALID_CITATION_REGEX =
  /\s*(?:\\ue202|)turn\{?\d+\}?(search|news|image|video|ref|file)\{?\d+\}?/g;

export type CitationRefType =
  | "search"
  | "image"
  | "news"
  | "video"
  | "ref"
  | "file";

export interface Citation {
  turn: number;
  refType: string;
  index: number;
}

export interface ResolvedWebCitation {
  source: WebSearchResult;
  /** One-based position in the deduplicated Sources list. */
  number: number;
}

export interface WebCitationIndex {
  /** Search results in the same deduplicated order shown by the Sources UI. */
  sources: WebSearchResult[];
  resolve: (
    turn: number,
    refType: CitationRefType,
    index: number,
  ) => ResolvedWebCitation | undefined;
}

const WEB_SOURCE_REF_TYPES = new Set<CitationRefType>([
  "search",
  "news",
  "ref",
]);

/**
 * Index web-search results using LibreChat's citation coordinates:
 * `turn` is the zero-based web_search invocation and `index` is the result
 * within that invocation. Source numbers are deduplicated by URL so inline
 * pills always agree with the Sources list.
 */
export function buildWebCitationIndex(
  parts: readonly unknown[],
): WebCitationIndex {
  const sources: WebSearchResult[] = [];
  const numberByUrl = new Map<string, number>();
  const byTurn: ResolvedWebCitation[][] = [];
  const flat: ResolvedWebCitation[] = [];

  for (const part of parts) {
    const searchPart = part as WebSearchPart;
    if (searchPart?.type !== "tool-web_search") continue;

    const resolvedTurn: ResolvedWebCitation[] = [];
    const results = Array.isArray(searchPart.output) ? searchPart.output : [];
    for (const source of results) {
      let number = numberByUrl.get(source.link);
      if (number === undefined) {
        sources.push(source);
        number = sources.length;
        numberByUrl.set(source.link, number);
      }
      const resolved = { source, number };
      resolvedTurn.push(resolved);
      flat.push(resolved);
    }
    byTurn.push(resolvedTurn);
  }

  return {
    sources,
    resolve(turn, refType, index) {
      if (!WEB_SOURCE_REF_TYPES.has(refType)) return undefined;

      const exact = byTurn[turn]?.[index];
      if (exact) return exact;

      // Older Overtchat prompts used turn0 plus an index flattened across all
      // search calls. Keep those persisted messages useful when the exact
      // turn-local coordinate does not exist.
      return flat[index];
    },
  };
}

export function stripCitationMarkers(text: string): string {
  return text.replace(INVALID_CITATION_REGEX, "").replace(CLEANUP_REGEX, "");
}
