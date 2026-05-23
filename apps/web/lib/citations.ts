/**
 * Citation Regex Patterns (ported verbatim from LibreChat client/src/utils/citations.ts)
 *
 * These patterns handle two formats that LLMs may output:
 * 1. Literal escape sequences: "turn0search0" (backslash + "ue202" = 6 chars)
 * 2. Actual Unicode characters: "turn0search0" (U+E202 = 1 char, private use area)
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

export const SPAN_REGEX = /((?:\\ue203|).*?(?:\\ue204|))/g;

export const COMPOSITE_REGEX = /((?:\\ue200|).*?(?:\\ue201|))/g;

export const STANDALONE_PATTERN =
  /(?:\\ue202|)turn(\d+)(search|image|news|video|ref|file)(\d+)/g;

export const CLEANUP_REGEX =
  /\\ue200|\\ue201|\\ue202|\\ue203|\\ue204|\\ue206||||||/g;

export const INVALID_CITATION_REGEX =
  /\s*(?:\\ue202|)turn\d+(search|news|image|video|ref|file)\d+/g;

export type CitationRefType = "search" | "image" | "news" | "video" | "ref" | "file";

export interface Citation {
  turn: number;
  refType: string;
  index: number;
}

export function stripCitationMarkers(text: string): string {
  return text.replace(INVALID_CITATION_REGEX, "").replace(CLEANUP_REGEX, "");
}
