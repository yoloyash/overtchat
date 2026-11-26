const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g;
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!|~<>])/g;
const TABLE_DIVIDER = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-+:?[ \t]*\|?[ \t]*$/gm;
const TABLE_ROW = /^[ \t]*\|(.*)\|[ \t]*$/gm;
const RULE = /^[ \t]*(?:([-*_])[ \t]*){3,}$/gm;
const LINE_PREFIX = /^[ \t]*(?:>[ \t]?)*(?:(?:#{1,6}|[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/gm;
const EMPHASIS = /(?<!\w)(\*\*|__|\*|_|~~)(?=\S)([^\n]*?\S)\1(?!\w)/g;
const HTML_TAG =
  /<\/?(?:br|p|div|span|sup|sub|kbd|u|b|i|em|strong|small|mark|details|summary)\b[^>\n]*>/gi;

/**
 * Reduces Markdown to the text a reader sees, for places that cannot render
 * it, such as notifications. Code, link text and table cells stay; markers,
 * fences, table dividers and rules go. Line breaks are kept.
 */
export function markdownToPlainText(markdown: string): string {
  // Code and escaped characters are literal: set them aside so the marker
  // rules below cannot touch them, then put them back at the end.
  const kept: string[] = [];
  const keep = (text: string) => `\u0000${kept.push(text) - 1}\u0000`;
  return markdown
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(FENCE, (_match, _fence, code: string) => `${keep(code.trim())}\n`)
    .replace(INLINE_CODE, (_match, _ticks, code: string) => keep(code.trim()))
    .replace(ESCAPE, (_match, character: string) => keep(character))
    .replace(TABLE_DIVIDER, "")
    .replace(TABLE_ROW, (_match, cells: string) => cells.replace(/[ \t]*\|[ \t]*/g, " ").trim())
    .replace(RULE, "")
    .replace(LINE_PREFIX, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^\s>]+)>/g, "$1")
    .replace(HTML_TAG, " ")
    .replace(EMPHASIS, "$2")
    // A second pass unwraps the inner marker of `***both***`.
    .replace(EMPHASIS, "$2")
    .replace(/`+/g, "")
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)] ?? "")
    .trim();
}

/** Collapses whitespace and clips to `limit` characters, ending with "…" when cut. */
export function clipText(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1).trimEnd()}…`
    : collapsed;
}
