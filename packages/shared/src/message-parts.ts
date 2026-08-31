import type { UIMessage } from "ai";
import { isMcpToolName } from "./mcp";
import { isMemoryToolPart, type MemoryToolPart } from "./memory-tools";

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

export type MessageSegment =
  | { kind: "text"; part: AnyPart; index: number }
  | { kind: "activity"; parts: AnyPart[]; startIndex: number }
  | { kind: "memory"; parts: MemoryToolPart[]; startIndex: number };

/**
 * Fold a message's flat parts into ordered render segments shared by web and
 * mobile. Blank step-boundary text and other non-renderable parts are omitted.
 */
export function groupMessageParts(
  parts: readonly AnyPart[],
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let run: Extract<MessageSegment, { kind: "activity" | "memory" }> | null =
    null;

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
      const text = (part as { text?: string }).text;
      if (!text?.trim()) return;
      flush();
      segments.push({ kind: "text", part, index });
      return;
    }
    if (isMemoryToolPart(part)) {
      appendMemory(part, index);
      return;
    }
    if (isActivityPart(part)) appendActivity(part, index);
  });

  flush();
  return segments;
}
