/**
 * Remark plugin that transforms LibreChat-style PUA citation markers in text
 * nodes into custom mdast nodes consumed by Streamdown's component map.
 *
 * Ported from LibreChat client/src/components/Web/plugin.ts.
 */

import { visit } from "unist-util-visit";
import type { Node, Parent } from "unist";
import type { Text } from "mdast";
import {
  SPAN_REGEX,
  COMPOSITE_REGEX,
  STANDALONE_PATTERN,
  CLEANUP_REGEX,
  type Citation,
} from "./citations";

interface CitationNodeData {
  hName: string;
  hProperties: Record<string, unknown>;
}

type CitationNode =
  | Text
  | (Parent & { type: "highlighted-text"; data: CitationNodeData })
  | { type: "composite-citation"; data: CitationNodeData }
  | { type: "citation"; data: CitationNodeData };

// Cheap pre-filter: most assistant text contains no PUA markers, and we want
// to skip three regex scans per text node during streaming.
const PUA_MARKER_REGEX = /[\u{E200}-\u{E206}]|\\ue20[0-6]/u;

function isStandaloneMarker(text: string, position: number): boolean {
  const beforeText = text.substring(0, position);
  const lastUe200Literal = beforeText.lastIndexOf("\\ue200");
  const lastUe200Char = beforeText.lastIndexOf("\u{E200}");
  const lastUe200 = Math.max(lastUe200Literal, lastUe200Char);
  const lastUe201Literal = beforeText.lastIndexOf("\\ue201");
  const lastUe201Char = beforeText.lastIndexOf("\u{E201}");
  const lastUe201 = Math.max(lastUe201Literal, lastUe201Char);
  return lastUe200 === -1 || (lastUe201 !== -1 && lastUe201 > lastUe200);
}

interface RegexBundle {
  span: RegExp;
  composite: RegExp;
  standalone: RegExp;
  compositeRef: RegExp;
}

function findNextMatch(
  text: string,
  position: number,
  rx: RegexBundle,
): { type: "span" | "composite" | "standalone"; match: RegExpExecArray } | null {
  rx.span.lastIndex = position;
  rx.composite.lastIndex = position;
  rx.standalone.lastIndex = position;

  const spanMatch = rx.span.exec(text);
  const compositeMatch = rx.composite.exec(text);

  let standaloneMatch: RegExpExecArray | null = null;
  rx.standalone.lastIndex = position;
  let m: RegExpExecArray | null;
  while (!standaloneMatch && (m = rx.standalone.exec(text)) !== null) {
    if (isStandaloneMarker(text, m.index)) standaloneMatch = m;
  }

  let best: { type: "span" | "composite" | "standalone"; match: RegExpExecArray } | null =
    null;
  const considerCandidate = (
    candidate: RegExpExecArray | null,
    type: "span" | "composite" | "standalone",
  ) => {
    if (!candidate) return;
    if (!best || candidate.index < best.match.index) {
      best = { type, match: candidate };
    }
  };
  considerCandidate(spanMatch, "span");
  considerCandidate(compositeMatch, "composite");
  considerCandidate(standaloneMatch, "standalone");
  return best;
}

function processTree(tree: Node) {
  const rx: RegexBundle = {
    span: new RegExp(SPAN_REGEX.source, "g"),
    composite: new RegExp(COMPOSITE_REGEX.source, "g"),
    standalone: new RegExp(STANDALONE_PATTERN.source, "g"),
    compositeRef: new RegExp(STANDALONE_PATTERN.source, "g"),
  };

  visit(tree, "text", (node, index, parent) => {
    const textNode = node as Text;
    const parentNode = parent as Parent | undefined;
    if (typeof textNode.value !== "string") return;
    if (index === undefined || !parentNode) return;
    if (!PUA_MARKER_REGEX.test(textNode.value)) return;

    const original = textNode.value;
    const segments: CitationNode[] = [];
    let pos = 0;
    const typeCounts = { span: 0, composite: 0, standalone: 0 };

    while (pos < original.length) {
      const next = findNextMatch(original, pos, rx);
      if (!next) {
        const tail = original.substring(pos).replace(CLEANUP_REGEX, "");
        if (tail) segments.push({ type: "text", value: tail } as Text);
        break;
      }

      const { type, match } = next;
      const matchIndex = match.index;
      const matchText = match[0];

      if (matchIndex > pos) {
        const before = original
          .substring(pos, matchIndex)
          .replace(CLEANUP_REGEX, "");
        if (before) segments.push({ type: "text", value: before } as Text);
      }

      const citationId = `${type}-${typeCounts[type]}-${matchIndex}`;

      if (type === "span") {
        const cleanText = matchText.replace(/\\ue203|\\ue204|\u{E203}|\u{E204}/gu, "");
        let associatedCitationId: string | null = null;
        const endOfSpan = matchIndex + matchText.length;
        const nextCitation = findNextMatch(original, endOfSpan, rx);
        if (
          nextCitation &&
          (nextCitation.type === "standalone" || nextCitation.type === "composite") &&
          nextCitation.match.index - endOfSpan < 5
        ) {
          associatedCitationId = `${nextCitation.type}-${typeCounts[nextCitation.type]}-${nextCitation.match.index}`;
        }
        segments.push({
          type: "highlighted-text",
          data: {
            hName: "highlighted-text",
            hProperties: { citationid: associatedCitationId },
          },
          children: [{ type: "text", value: cleanText } as Text],
        } as CitationNode);
        typeCounts.span++;
      } else if (type === "composite") {
        rx.compositeRef.lastIndex = 0;
        const citations: Citation[] = [];
        let refMatch: RegExpExecArray | null;
        while ((refMatch = rx.compositeRef.exec(matchText)) !== null) {
          citations.push({
            turn: Number(refMatch[1]),
            refType: refMatch[2],
            index: Number(refMatch[3]),
          });
        }
        if (citations.length > 0) {
          segments.push({
            type: "composite-citation",
            data: {
              hName: "composite-citation",
              hProperties: { citations: JSON.stringify(citations), citationid: citationId },
            },
          } as CitationNode);
        }
        typeCounts.composite++;
      } else {
        segments.push({
          type: "citation",
          data: {
            hName: "citation",
            hProperties: {
              turn: Number(match[1]),
              reftype: match[2],
              index: Number(match[3]),
              citationid: citationId,
            },
          },
        } as CitationNode);
        typeCounts.standalone++;
      }

      pos = matchIndex + matchText.length;
    }

    if (segments.length > 0) {
      parentNode.children.splice(index, 1, ...(segments as Parent["children"]));
      return index + segments.length;
    }
    if (textNode.value !== textNode.value.replace(CLEANUP_REGEX, "")) {
      textNode.value = textNode.value.replace(CLEANUP_REGEX, "");
    }
  });
}

export function unicodeCitation() {
  return (tree: Node) => {
    processTree(tree);
  };
}
