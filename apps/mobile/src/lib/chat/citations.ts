import type { UIMessage } from "ai";
import {
  STANDALONE_PATTERN,
  brandName,
  buildWebCitationIndex,
  stripCitationMarkers,
  type CitationRefType,
  type ResolvedWebCitation,
} from "@overtchat/shared";

export type SourceLookup = (
  turn: number,
  refType: CitationRefType,
  index: number,
) => ResolvedWebCitation | undefined;

export function buildSourceLookup(message: UIMessage): SourceLookup {
  return buildWebCitationIndex(message.parts).resolve;
}

/**
 * Replace citation markers in `text` with markdown links to the cited source's
 * domain (e.g. " nvidia.com "). Cleanup any leftover composite/highlight
 * markers so they don't bleed through to the rendered output.
 *
 * Returns both the rewritten text and the set of URLs we promoted to citation
 * links — the caller uses that set to render those links as pill badges
 * instead of plain underlined text.
 */
export function applyCitationsToMarkdown(
  text: string,
  lookup: SourceLookup,
): { text: string; citationUrls: Set<string> } {
  const citationUrls = new Set<string>();
  const pattern = new RegExp(STANDALONE_PATTERN.source, "g");
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [whole, turnStr, refType, indexStr] = match;
    out += text.slice(lastIndex, match.index);
    const resolved = lookup(
      Number(turnStr),
      refType as CitationRefType,
      Number(indexStr),
    );
    if (resolved) {
      out += ` [${brandName(resolved.source.link)}](${resolved.source.link}) `;
      citationUrls.add(resolved.source.link);
    } else {
      // unknown source — drop the marker entirely
      out += "";
    }
    lastIndex = match.index + whole.length;
  }
  out += text.slice(lastIndex);
  return { text: stripCitationMarkers(out), citationUrls };
}
