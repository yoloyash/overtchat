import type { ToolState } from "./tools";
import type { UIMessage } from "ai";

export const OPENUI_PRESENT_TOOL_NAME = "present_openui" as const;
export const OPENUI_TOOL_PART_TYPE = "tool-present_openui" as const;

export interface OpenUIToolInput {
  ui?: string;
  text?: string;
}

export interface OpenUIToolOutput {
  displayed: true;
  /** Readable content for copy, speech, search and clients without a renderer. */
  text?: string;
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

export function isOpenUIToolPart(part: {
  type: string;
}): part is OpenUIToolPart {
  return part.type === OPENUI_TOOL_PART_TYPE;
}

/** Strip accidental outer markdown fences while preserving streaming lines. */
export function normalizeOpenUILang(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("```")) return raw;
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return "";
  const body = trimmed.slice(newline + 1);
  return body.replace(/\n?```\s*$/, "");
}

export const OPENUI_MAX_PROGRAM_LENGTH = 100_000;
export const OPENUI_MAX_ACTION_LENGTH = 64_000;

export type OpenUIJson =
  | null
  | boolean
  | number
  | string
  | OpenUIJson[]
  | { [key: string]: OpenUIJson };
export type OpenUIFormState = Record<string, OpenUIJson>;

/** Submitted interactions travel with their user turn, including in exports. */
export interface OpenUIAction {
  messageId: string;
  toolCallId: string;
  message: string;
  context?: OpenUIJson;
  formName?: string;
  formState?: OpenUIFormState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJson(value: unknown, depth = 0): value is OpenUIJson {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => isJson(item, depth + 1));
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        !["__proto__", "constructor", "prototype"].includes(key) &&
        isJson(item, depth + 1),
    )
  );
}

/** Validate actions from native bridges, requests, persisted messages and imports. */
export function readOpenUIAction(value: unknown): OpenUIAction | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["messageId", "toolCallId", "message"] as const) {
    if (
      typeof value[key] !== "string" ||
      !value[key].trim() ||
      value[key].length > (key === "message" ? 4000 : 200)
    )
      return undefined;
  }
  if (
    value.formName !== undefined &&
    (typeof value.formName !== "string" || value.formName.length > 200)
  )
    return undefined;
  if (value.context !== undefined && !isJson(value.context)) return undefined;
  if (
    value.formState !== undefined &&
    (!isRecord(value.formState) || !isJson(value.formState))
  )
    return undefined;
  const action = {
    messageId: value.messageId as string,
    toolCallId: value.toolCallId as string,
    message: value.message as string,
    ...(value.context !== undefined
      ? { context: value.context as OpenUIJson }
      : {}),
    ...(typeof value.formName === "string" ? { formName: value.formName } : {}),
    ...(value.formState !== undefined
      ? { formState: value.formState as OpenUIFormState }
      : {}),
  };
  return JSON.stringify(action).length <= OPENUI_MAX_ACTION_LENGTH
    ? action
    : undefined;
}

export function openUIActionOf(message: UIMessage): OpenUIAction | undefined {
  return message.role === "user" && isRecord(message.metadata)
    ? readOpenUIAction(message.metadata.openuiAction)
    : undefined;
}

export function openUIStateKey(messageId: string, toolCallId: string): string {
  return JSON.stringify([messageId, toolCallId]);
}

/** Later accepted user turns hydrate earlier cards without mutating past messages. */
export function collectOpenUIStates(
  messages: UIMessage[],
): Map<string, OpenUIFormState> {
  const states = new Map<string, OpenUIFormState>();
  for (const message of messages) {
    const action = openUIActionOf(message);
    if (action?.formState) {
      const key = openUIStateKey(action.messageId, action.toolCallId);
      states.set(key, { ...states.get(key), ...action.formState });
    }
  }
  return states;
}

export function openUIFallbackText(part: OpenUIToolPart): string {
  if (typeof part.output?.text === "string" && part.output.text.trim())
    return part.output.text;
  if (typeof part.input?.text === "string" && part.input.text.trim())
    return part.input.text;
  return "";
}

/** Shared by native/browser copy and speech; the canonical parts remain intact. */
export function readableMessageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .flatMap((part) =>
      part.type === "text"
        ? [part.text]
        : isOpenUIToolPart(part)
          ? [`\n${openUIFallbackText(part)}\n`]
          : [],
    )
    .join("");
}

export function withOpenUIFallback(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      isOpenUIToolPart(part)
        ? {
            type: "text" as const,
            text:
              openUIFallbackText(part) ||
              "Interactive UI is unavailable in this client.",
          }
        : part,
    ),
  }));
}
