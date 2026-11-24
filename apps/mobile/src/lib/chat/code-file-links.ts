import { codeFileLinkName } from "@overtchat/shared";

// A link or image whose target may hold one level of parentheses, as in `b (2).csv`.
const LINK = /!?\[[^\]\n]*\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Puts each link on a line of only sandbox file links into a paragraph of its
 * own, which the renderer draws as a block: an image file in full, any other
 * file as a card. Links inside sentences, lists and code stay as written.
 */
export function separateFileLinks(markdown: string): string {
  if (!markdown.includes("](")) return markdown;
  const out: string[] = [];
  let fence: string | null = null;
  let separated = false;
  for (const line of markdown.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (mark && (fence === null || (mark[0] === fence[0] && mark.length >= fence.length))) {
      fence = fence === null ? mark : null;
    }
    const links = fence === null && !mark ? fileLinks(line) : null;
    if (!links) {
      // A paragraph that follows the separated links must not join the last one.
      if (separated && line.trim()) out.push("");
      separated = false;
      out.push(line);
      continue;
    }
    for (const link of links) {
      if (out.length && out[out.length - 1].trim()) out.push("");
      out.push(link);
    }
    separated = true;
  }
  return out.join("\n");
}

/** The links of a line that holds nothing but sandbox file links, else null. */
function fileLinks(line: string): string[] | null {
  if (!line || /^\s/.test(line)) return null;
  const links: string[] = [];
  let end = 0;
  for (const match of line.matchAll(LINK)) {
    if (line.slice(end, match.index).trim()) return null;
    if (codeFileLinkName(match[1]) === null) return null;
    links.push(match[0]);
    end = match.index + match[0].length;
  }
  return links.length && !line.slice(end).trim() ? links : null;
}
