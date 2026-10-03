import type { UIMessage } from "ai";
import { isMcpToolName } from "./mcp";
import { isMemoryToolPart, type MemoryToolPart } from "./memory-tools";

import { isImageToolPart, type ImageToolPart } from "./images";

type AnyPart = UIMessage["parts"][number];

/** Join text across continuation step markers before model replay. Otherwise
 * convertToModelMessages closes the partial answer and starts another assistant
 * message, so only the last fragment is actually prefilled. Tool/reasoning step
 * boundaries stay intact, and the stored UIMessage is never mutated. */
export function joinContinuationTextParts(parts: readonly AnyPart[]): AnyPart[] {
  const joined: AnyPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      let previous = joined.at(-1);
      if (previous?.type === "step-start" && joined.at(-2)?.type === "text") {
        joined.pop();
        previous = joined.at(-1);
      }
      if (previous?.type === "text") {
        joined[joined.length - 1] = { ...previous, text: previous.text + part.text };
        continue;
      }
    }
    joined.push(part);
  }
  return joined;
}

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
  | { kind: "image"; part: ImageToolPart; index: number }
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
  let textRun: Extract<MessageSegment, { kind: "text" }> | undefined;
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
      // Continuations introduce another SDK text part (and a step boundary).
      // Render adjacent text together so an interrupted code fence stays open.
      if (textRun?.part.type === "text") {
        textRun.part = { ...part, text: textRun.part.text + (text ?? "") };
        return;
      }
      if (!text?.trim()) return;
      flush();
      textRun = { kind: "text", part, index };
      segments.push(textRun);
      return;
    }
    if (part.type !== "step-start") textRun = undefined;
    if (isImageToolPart(part)) {
      flush();
      segments.push({ kind: "image", part, index });
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
