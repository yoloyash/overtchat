import { math } from "@streamdown/math";
import { defaultRemarkPlugins } from "streamdown";
import { remark } from "remark";
import type { UIMessage } from "ai";
import { groupMessageParts, isManualCompactionMessage } from "@overtchat/shared";
import { stripCitationMarkers } from "@/lib/citations";
import { textOf } from "@/lib/chat/message";

export const CHAT_FIND_MAX_QUERY_LENGTH = 200;

/** One occurrence of the find query, addressed by message and position. */
export type ChatFindMatch = {
  messageId: string;
  messageIndex: number;
  occurrence: number;
};

type MarkdownNode = {
  type: string;
  value?: string;
  lang?: string | null;
  children?: MarkdownNode[];
};

// Parse with the same remark plugins Streamdown renders with, so counts follow
// the rendered text rather than the markdown source.
const markdownParser = remark().use([
  ...Object.values(defaultRemarkPlugins),
  math.remarkPlugin,
]);

// Rendered as non-text (images, KaTeX, raw HTML) or not rendered at all.
const SKIPPED_NODES = new Set([
  "html",
  "image",
  "imageReference",
  "inlineMath",
  "math",
  "definition",
  "footnoteDefinition",
  "yaml",
]);

// Fences that `MESSAGE_MARKDOWN_PLUGINS` renders as diagrams and previews.
const RENDERED_CODE_LANGUAGES = new Set(["mermaid", "svg", "html"]);

// Rendered chrome around the text: code block labels, diagram and preview
// cards, citation pills, and controls.
const IGNORED_ELEMENTS = [
  "[data-chat-find-ignore]",
  "[data-streamdown=code-block-header]",
  "[data-streamdown=code-block-actions]",
  "[data-streamdown=mermaid-block]",
  "[data-code-preview]",
  "[hidden]",
  // Streamdown renders links as buttons that confirm before opening.
  "button:not([data-streamdown=link])",
  "svg",
  ".katex",
].join(", ");

// Mirrors the DOM block boundaries in `collectChatFindRanges`, so a phrase
// never matches across two paragraphs, list items, or table cells.
const BLOCK_NODES = new Set([
  "blockquote",
  "break",
  "heading",
  "list",
  "listItem",
  "paragraph",
  "table",
  "tableCell",
  "tableRow",
  "thematicBreak",
]);

export const CHAT_FIND_BLOCK_TAGS = new Set([
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

function markdownFindSegments(markdown: string): string[] {
  const segments: string[] = [];
  let text = "";
  const flush = () => {
    if (text) segments.push(text);
    text = "";
  };
  const visit = (node: MarkdownNode) => {
    if (SKIPPED_NODES.has(node.type)) return;
    if (node.type === "code") {
      flush();
      if (RENDERED_CODE_LANGUAGES.has(node.lang?.toLowerCase() ?? "")) return;
      segments.push(node.value ?? "");
      return;
    }
    const block = BLOCK_NODES.has(node.type);
    if (block) flush();
    if (node.type === "text" || node.type === "inlineCode") {
      text += (node.value ?? "").replace(/\r?\n/g, " ");
    }
    for (const child of node.children ?? []) visit(child);
    if (block) flush();
  };
  visit(markdownParser.parse(markdown) as MarkdownNode);
  flush();
  return segments;
}

const segmentCache = new WeakMap<UIMessage, string[]>();

/**
 * The visible text blocks of a message that find searches: the user's text and
 * the assistant's answer. Reasoning, tool activity, sources, and generated
 * cards stay out, as they are collapsed or not text.
 */
export function chatFindSegments(message: UIMessage): string[] {
  const cached = segmentCache.get(message);
  if (cached) return cached;
  let segments: string[] = [];
  if (isManualCompactionMessage(message)) {
    segments = [];
  } else if (message.role === "user") {
    const text = textOf(message).replace(/\r?\n/g, " ");
    segments = text ? [text] : [];
  } else {
    for (const segment of groupMessageParts(message.parts)) {
      if (segment.kind !== "text") continue;
      const text = (segment.part as { text: string }).text;
      segments.push(...markdownFindSegments(stripCitationMarkers(text)));
    }
  }
  segmentCache.set(message, segments);
  return segments;
}

/** Case-insensitive, non-overlapping occurrence offsets of `query` in `text`. */
export function findOccurrences(text: string, query: string): number[] {
  if (!text || !query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  // Lowercasing can change length for a few scripts; offsets would then point
  // at the wrong characters, so search the original text instead.
  const folded = haystack.length === text.length && needle.length === query.length;
  const source = folded ? haystack : text;
  const target = folded ? needle : query;
  const offsets: number[] = [];
  let cursor = source.indexOf(target);
  while (cursor !== -1) {
    offsets.push(cursor);
    cursor = source.indexOf(target, cursor + target.length);
  }
  return offsets;
}

/** How many times `query` occurs in the text find searches in `message`. */
export function chatFindOccurrenceCount(
  message: UIMessage,
  query: string,
): number {
  let count = 0;
  for (const segment of chatFindSegments(message)) {
    count += findOccurrences(segment, query).length;
  }
  return count;
}

/**
 * Every match in order. `countOverride` replaces a message's predicted count,
 * e.g. with the count found in its rendered text once it has been on screen.
 */
export function collectChatFindMatches(
  messages: readonly UIMessage[],
  query: string,
  countOverride?: (message: UIMessage) => number | undefined,
): ChatFindMatch[] {
  if (!query) return [];
  const matches: ChatFindMatch[] = [];
  messages.forEach((message, messageIndex) => {
    const count =
      countOverride?.(message) ?? chatFindOccurrenceCount(message, query);
    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      matches.push({ messageId: message.id, messageIndex, occurrence });
    }
  });
  return matches;
}

/**
 * The index of the selected occurrence. When its message now holds fewer
 * occurrences, the message's last one stands in for it.
 */
export function resolveChatFindIndex(
  matches: readonly ChatFindMatch[],
  selection: { messageId: string; occurrence: number },
): number {
  let fallback = -1;
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match.messageId !== selection.messageId) continue;
    if (match.occurrence === selection.occurrence) return index;
    if (match.occurrence < selection.occurrence) fallback = index;
  }
  return fallback;
}

/**
 * Where a new query starts: the first match at or below the top of the
 * viewport, else the closest match above it.
 */
export function initialChatFindIndex(
  matches: readonly ChatFindMatch[],
  firstVisibleMessageIndex: number,
): number {
  if (!matches.length) return -1;
  const below = matches.findIndex(
    (match) => match.messageIndex >= firstVisibleMessageIndex,
  );
  return below === -1 ? matches.length - 1 : below;
}

export function stepChatFindIndex(
  index: number,
  total: number,
  delta: number,
): number {
  if (total <= 0) return -1;
  if (index < 0) return delta < 0 ? total - 1 : 0;
  return (((index + delta) % total) + total) % total;
}

/** Text ranges of each find match inside one rendered message row. */
export function collectChatFindRanges(row: Element, query: string): Range[] {
  if (!query) return [];
  const ranges: Range[] = [];
  let text = "";
  let nodes: { node: Text; start: number; end: number }[] = [];
  const flush = () => {
    let first = 0;
    for (const offset of findOccurrences(text, query)) {
      const endOffset = offset + query.length;
      while (first < nodes.length && nodes[first].end <= offset) first += 1;
      let last = first;
      while (last < nodes.length && nodes[last].end < endOffset) last += 1;
      const start = nodes[first];
      const end = nodes[last];
      if (!start || !end) continue;
      const range = row.ownerDocument.createRange();
      range.setStart(start.node, offset - start.start);
      range.setEnd(end.node, endOffset - end.start);
      ranges.push(range);
    }
    text = "";
    nodes = [];
  };
  const visit = (node: Node, inPre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      const start = text.length;
      text += inPre ? value : value.replace(/\r?\n/g, " ");
      nodes.push({ node: node as Text, start, end: text.length });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(IGNORED_ELEMENTS)) {
      flush();
      return;
    }
    const tag = element.tagName.toLowerCase();
    const block = CHAT_FIND_BLOCK_TAGS.has(tag);
    if (block) flush();
    for (const child of element.childNodes) visit(child, inPre || tag === "pre");
    if (block) flush();
  };
  for (const scope of row.querySelectorAll("[data-chat-find-text]")) {
    visit(scope, false);
    flush();
  }
  return ranges;
}
