import type { UIMessage } from "ai";
import { isMcpToolName } from "@overtchat/shared";
import {
  isMemoryToolPart,
  type MemoryToolPart,
} from "@/lib/personalization/tool-parts";

type AnyPart = UIMessage["parts"][number];

const ACTIVITY_TYPES = new Set([
  "reasoning",
  "tool-web_search",
  "tool-fetch_url",
]);

export function isActivityPart(part: AnyPart): boolean {
  return (
    ACTIVITY_TYPES.has(part.type) ||
    (part.type === "dynamic-tool" && isMcpToolName(part.toolName))
  );
}

export type Segment =
  | { kind: "text"; part: AnyPart; index: number }
  | { kind: "activity"; parts: AnyPart[]; startIndex: number }
  | { kind: "memory"; parts: MemoryToolPart[]; startIndex: number };

/**
 * Fold a message's flat parts list into ordered segments. Each contiguous run
 * of reasoning/general tools becomes an `activity`; memory mutations become a
 * dedicated `memory` artifact; answer text remains `text`. Unrenderable parts
 * (sources, files, step markers) are dropped. Original indexes provide stable
 * keys and let callers identify the last, potentially streaming segment.
 */
export function groupMessageParts(parts: readonly AnyPart[]): Segment[] {
  const segments: Segment[] = [];
  let run: Extract<Segment, { kind: "activity" | "memory" }> | null = null;

  const flush = () => {
    if (run) {
      segments.push(run);
      run = null;
    }
  };

  const appendActivity = (part: AnyPart, index: number) => {
    if (run?.kind !== "activity") {
      flush();
      run = { kind: "activity", parts: [], startIndex: index };
    }
    run.parts.push(part);
  };

  const appendMemory = (part: MemoryToolPart, index: number) => {
    if (run?.kind !== "memory") {
      flush();
      run = { kind: "memory", parts: [], startIndex: index };
    }
    run.parts.push(part);
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
    if (isMemoryToolPart(part)) {
      appendMemory(part, index);
      return;
    }
    if (isActivityPart(part)) {
      appendActivity(part, index);
    }
  });

  flush();
  return segments;
}
