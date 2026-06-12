import type { UIMessage } from "ai";

type AnyPart = UIMessage["parts"][number];

const ACTIVITY_TYPES = new Set([
  "reasoning",
  "tool-web_search",
  "tool-fetch_url",
]);

export function isActivityPart(part: AnyPart): boolean {
  return ACTIVITY_TYPES.has(part.type);
}

export type Segment =
  | { kind: "text"; part: AnyPart; index: number }
  | { kind: "activity"; parts: AnyPart[]; startIndex: number };

/**
 * Fold a message's flat parts list into ordered segments: each contiguous run
 * of "work" (reasoning + tool calls) becomes one `activity` segment, broken by
 * `text` parts (the answer). Unrenderable parts (sources, files, step markers)
 * are dropped, matching the previous flat-map behavior. `index`/`startIndex`
 * are original-array positions, so callers keep stable keys and can tell which
 * segment is last / still streaming.
 *
 * Kept in lockstep with the web copy (apps/web/lib/chat/parts.ts) so both
 * clients group the model's activity identically.
 */
export function groupMessageParts(parts: readonly AnyPart[]): Segment[] {
  const segments: Segment[] = [];
  let run: AnyPart[] | null = null;
  let runStart = 0;

  const flush = () => {
    if (run) {
      segments.push({ kind: "activity", parts: run, startIndex: runStart });
      run = null;
    }
  };

  parts.forEach((part, index) => {
    if (part.type === "text") {
      // Multi-step tool calling emits blank `text` parts at step boundaries.
      // They aren't a real answer, so they must NOT break the activity run —
      // otherwise contiguous tool calls split into several "Searched the web"
      // blocks separated by invisible empty text. Drop them; only text with
      // real content flushes the run and renders as prose.
      const text = (part as { text?: string }).text;
      if (!text || !text.trim()) return;
      flush();
      segments.push({ kind: "text", part, index });
      return;
    }
    if (isActivityPart(part)) {
      if (!run) {
        run = [];
        runStart = index;
      }
      run.push(part);
    }
  });

  flush();
  return segments;
}
