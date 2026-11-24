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

/** Links to cited sources carry this scheme, which the renderer draws as pills. */
export const CITATION_SCHEME = "cite:";

export function buildSourceLookup(message: UIMessage): SourceLookup {
  return buildWebCitationIndex(message.parts).resolve;
}

/** The address a link opens: a cited source's own address, or the link's. */
export function linkTarget(url: string): string {
  return url.startsWith(CITATION_SCHEME) ? url.slice(CITATION_SCHEME.length) : url;
}

/**
 * Replaces citation markers in `text` with Markdown links to the cited source,
 * labelled with its site name and marked with the citation scheme. Markers
 * that name no source are dropped, as are leftover composite markers.
 */
export function applyCitationsToMarkdown(text: string, lookup: SourceLookup): string {
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
      const { link } = resolved.source;
      out += ` [${brandName(link)}](<${CITATION_SCHEME}${link.replace(/[<>]/g, encodeURIComponent)}>) `;
    }
    lastIndex = match.index + whole.length;
  }
  out += text.slice(lastIndex);
  return stripCitationMarkers(out);
}
