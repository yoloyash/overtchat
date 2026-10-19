import type { ToolState } from "./tools";

export const OPENUI_PRESENT_TOOL_NAME = "present_openui" as const;
export const OPENUI_TOOL_PART_TYPE = "tool-present_openui" as const;

export interface OpenUIToolInput {
  ui?: string;
}

export interface OpenUIToolOutput {
  displayed: true;
}

export interface OpenUIToolPart {
  type: typeof OPENUI_TOOL_PART_TYPE;
  toolCallId: string;
  state: ToolState;
  input?: OpenUIToolInput;
  rawInput?: OpenUIToolInput;
  output?: OpenUIToolOutput;
  errorText?: string;
}

export function isOpenUIToolPart(part: { type: string }): part is OpenUIToolPart {
  return part.type === OPENUI_TOOL_PART_TYPE;
}

/** Strip accidental outer markdown fences while preserving streaming lines. */
export function normalizeOpenUILang(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("```")) return raw;
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return "";
  const body = trimmed.slice(newline + 1);
  return body.replace(/\n?```\s*$/, "");
}
