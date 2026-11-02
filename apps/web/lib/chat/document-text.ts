import { countTextTokens } from "@/lib/chat/context-budget";

// Count tokens in short pieces cut before whitespace. Cutting there leaves
// ordinary text tokenized exactly as a whole, while long unbroken runs (CJK,
// emoji, encoded data) avoid the tokenizer's quadratic cost on huge words and
// count slightly high, which keeps budgets conservative. Pieces are grouped
// into segments whose counts are cached for prefix scans, and scans stop as
// soon as a budget is reached instead of measuring the whole document.
const PIECE_CHARS = 64;
const SEGMENT_CHARS = 2_000;
const CACHE_LIMIT = 128;

/** Per-document segment counts for prefix scans; documents are immutable. */
const prefixSegments = new Map<string, number[]>();

function cachedSegments(key: string | undefined): number[] {
  if (!key) return [];
  const existing = prefixSegments.get(key);
  if (existing) {
    prefixSegments.delete(key);
    prefixSegments.set(key, existing);
    return existing;
  }
  const created: number[] = [];
  prefixSegments.set(key, created);
  if (prefixSegments.size > CACHE_LIMIT) {
    prefixSegments.delete(prefixSegments.keys().next().value!);
  }
  return created;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x3000
  );
}

/** Move an index off the middle of a surrogate pair. */
function alignToCodePoint(text: string, index: number): number {
  return index > 0 &&
    index < text.length &&
    isLowSurrogate(text.charCodeAt(index)) &&
    isHighSurrogate(text.charCodeAt(index - 1))
    ? index - 1
    : index;
}

function pieceEnd(text: string, start: number): number {
  const limit = start + PIECE_CHARS;
  if (limit >= text.length) return text.length;
  for (let i = limit; i > start; i--) {
    if (isWhitespace(text.charCodeAt(i))) return i;
  }
  return alignToCodePoint(text, limit);
}

function segmentEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && end - start < SEGMENT_CHARS) {
    end = pieceEnd(text, end);
  }
  return end;
}

function countRange(text: string, start: number, end: number): number {
  let total = 0;
  for (let position = start; position < end; ) {
    const next = Math.min(end, pieceEnd(text, position));
    total += countTextTokens(text.slice(position, next));
    position = next;
  }
  return total;
}

/**
 * Walk segments from `start`, calling `visit` with each segment's token
 * count, until `visit` returns false or the text ends. Segments starting at 0
 * have fixed boundaries, so their counts are cached per document.
 */
function walkSegments(
  text: string,
  start: number,
  key: string | undefined,
  visit: (segmentStart: number, segmentEnd: number, tokens: number) => boolean,
): void {
  const cache = start === 0 ? cachedSegments(key) : [];
  let position = start;
  for (let i = 0; position < text.length; i++) {
    const end = segmentEnd(text, position);
    let tokens = cache[i];
    if (tokens === undefined) {
      tokens = countRange(text, position, end);
      if (start === 0 && key) cache[i] = tokens;
    }
    if (!visit(position, end, tokens)) return;
    position = end;
  }
}

/** Token count of the whole text, or a value above `limit` once exceeded. */
export function measureTokens(
  text: string,
  limit: number,
  key?: string,
): number {
  let total = 0;
  walkSegments(text, 0, key, (_start, _end, tokens) => {
    total += tokens;
    return total <= limit;
  });
  return total;
}

/**
 * End of the longest range from `start` that fits `budget` tokens, moved back
 * to a line or word break near the end when one exists. Always advances when
 * the budget allows at least one character.
 */
export function rangeEnd(
  text: string,
  start: number,
  budget: number,
  key?: string,
): number {
  let end = start;
  let used = 0;
  walkSegments(text, start, key, (segmentStart, segmentStop, tokens) => {
    if (used + tokens <= budget) {
      used += tokens;
      end = segmentStop;
      return true;
    }
    // The budget ends inside this segment: walk its pieces, then search
    // characters within the piece that crosses the budget.
    for (let position = segmentStart; position < segmentStop; ) {
      const next = Math.min(segmentStop, pieceEnd(text, position));
      const pieceTokens = countTextTokens(text.slice(position, next));
      if (used + pieceTokens <= budget) {
        used += pieceTokens;
        end = next;
        position = next;
        continue;
      }
      const room = budget - used;
      let low = position;
      let high = next;
      while (high - low > 1) {
        const middle = alignToCodePoint(text, Math.floor((low + high) / 2));
        if (middle <= low) break;
        if (countTextTokens(text.slice(position, middle)) <= room) {
          low = middle;
        } else {
          high = middle;
        }
      }
      end = low;
      break;
    }
    return false;
  });
  if (end >= text.length || end <= start) return end;
  return niceBreak(text, start, end);
}

function niceBreak(text: string, start: number, end: number): number {
  const length = end - start;
  const newline = text.lastIndexOf("\n", end - 1);
  if (newline >= start && newline + 1 >= start + Math.ceil(length * 0.9)) {
    return newline + 1;
  }
  const window = text.slice(Math.max(start, end - Math.ceil(length * 0.02)), end);
  const space = window.search(/\s\S*$/u);
  if (space >= 0) {
    return Math.max(start, end - Math.ceil(length * 0.02)) + space + 1;
  }
  return end;
}

/** Clamp a model-supplied offset into the text without splitting a character. */
export function normalizeOffset(text: string, offset: number): number {
  return alignToCodePoint(text, Math.min(Math.max(0, Math.floor(offset)), text.length));
}

export interface TextMatch {
  start: number;
  end: number;
  /** Distinct query terms in the match (phrase matches count every term). */
  score: number;
}

const MAX_SCANNED_MATCHES = 1_000;
const TERM_WINDOW = 400;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function phrasePattern(query: string): RegExp | null {
  const parts = query.trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(parts.map(escapeRegExp).join("\\s+"), "giu");
}

export function queryTerms(query: string): string[] {
  const terms = query
    .toLocaleLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((term) => term.length >= 2);
  return [...new Set(terms)];
}

/** Case-insensitive matches of the whole query, whitespace-insensitive. */
export function findPhrase(text: string, query: string): TextMatch[] {
  const pattern = phrasePattern(query);
  if (!pattern) return [];
  const terms = Math.max(1, queryTerms(query).length);
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (!match[0]) continue;
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      score: terms,
    });
    if (matches.length >= MAX_SCANNED_MATCHES) break;
  }
  return matches;
}

/**
 * Passages where most query terms occur close together, best first. Used
 * when the exact phrase does not occur.
 */
export function findTerms(text: string, query: string): TextMatch[] {
  const terms = queryTerms(query);
  if (terms.length < 2) return [];
  const needed = Math.min(terms.length, Math.max(2, Math.ceil(terms.length * 0.6)));
  const occurrences: Array<{ start: number; end: number; term: number }> = [];
  terms.forEach((term, index) => {
    const pattern = new RegExp(escapeRegExp(term), "giu");
    let count = 0;
    for (const match of text.matchAll(pattern)) {
      occurrences.push({
        start: match.index,
        end: match.index + match[0].length,
        term: index,
      });
      if (++count >= MAX_SCANNED_MATCHES) break;
    }
  });
  occurrences.sort((a, b) => a.start - b.start || a.term - b.term);

  const candidates: TextMatch[] = [];
  for (let i = 0; i < occurrences.length; i++) {
    const seen = new Set<number>();
    let end = occurrences[i].end;
    for (
      let j = i;
      j < occurrences.length &&
      occurrences[j].start <= occurrences[i].start + TERM_WINDOW;
      j++
    ) {
      seen.add(occurrences[j].term);
      end = Math.max(end, occurrences[j].end);
    }
    if (seen.size >= needed) {
      candidates.push({ start: occurrences[i].start, end, score: seen.size });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: TextMatch[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(
        (match) => Math.abs(match.start - candidate.start) < TERM_WINDOW,
      )
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= MAX_SCANNED_MATCHES) break;
  }
  return selected;
}

/** A short single-line excerpt around a match, starting at a word boundary. */
export function snippetAround(
  text: string,
  match: Pick<TextMatch, "start" | "end">,
  radius = 120,
): { offset: number; snippet: string } {
  let from = Math.max(0, match.start - radius);
  let to = Math.min(text.length, match.end + radius);
  if (from > 0) {
    const space = text.slice(from, match.start).search(/\s/u);
    if (space >= 0) from += space + 1;
  }
  if (to < text.length) {
    const tail = text.slice(match.end, to);
    const space = tail.search(/\s\S*$/u);
    if (space >= 0) to = match.end + space;
  }
  from = alignToCodePoint(text, from);
  to = alignToCodePoint(text, to);
  const body = text.slice(from, to).replace(/\s+/gu, " ").trim();
  return {
    offset: from,
    snippet: `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`,
  };
}
