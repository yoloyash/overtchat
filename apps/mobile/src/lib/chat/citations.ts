import type { UIMessage } from "ai";
import {
  STANDALONE_PATTERN,
  brandName,
  stripCitationMarkers,
  type CitationRefType,
  type WebSearchPart,
  type WebSearchResult,
} from "@overtchat/shared";

const SOURCE_REF_TYPES = new Set<CitationRefType>(["search", "news", "ref"]);

export type SourceLookup = (
  turn: number,
  refType: CitationRefType,
  index: number,
) => WebSearchResult | undefined;

export function buildSourceLookup(message: UIMessage): SourceLookup {
  const flat: WebSearchResult[] = [];
  for (const part of message.parts) {
    const sp = part as unknown as WebSearchPart;
    if (sp.type === "tool-web_search" && Array.isArray(sp.output)) {
      flat.push(...sp.output);
    }
  }
  return (_turn, refType, index) => {
    if (!SOURCE_REF_TYPES.has(refType)) return undefined;
    return flat[index];
  };
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
    const source = lookup(
      Number(turnStr),
      refType as CitationRefType,
      Number(indexStr),
    );
    if (source) {
      out += ` [${brandName(source.link)}](${source.link}) `;
      citationUrls.add(source.link);
    } else {
      // unknown source — drop the marker entirely
      out += "";
    }
    lastIndex = match.index + whole.length;
  }
  out += text.slice(lastIndex);
  return { text: stripCitationMarkers(out), citationUrls };
}
