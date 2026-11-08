import type { TextStreamPart, ToolSet, UIMessage } from "ai";
import { CALL_TOOL_TOOL_NAME } from "@overtchat/shared";

/**
 * A model runs a skill's tools through `call_tool`, but everyone else sees
 * the tool itself: the chat shows a Gmail search as a Gmail search, and the
 * message is stored that way, so clients render skill tools as they always
 * have. The two transforms here cross that line in each direction.
 */

const CALL_TOOL_PART_TYPE = `tool-${CALL_TOOL_TOOL_NAME}` as const;

/** What a `call_tool` call names, when it names a tool a skill provides. */
function bridgedCall(
  input: unknown,
  bridged: ReadonlySet<string>,
): { name: string; params: Record<string, unknown> } | null {
  if (input === null || typeof input !== "object") return null;
  const { tool_name: name, params } = input as {
    tool_name?: unknown;
    params?: unknown;
  };
  if (typeof name !== "string" || !bridged.has(name)) return null;
  return {
    name,
    params:
      params !== null && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {},
  };
}

/**
 * Rewrites a model stream so each `call_tool` call of a skill tool appears
 * as a call of that tool. Its input is only known once the call is complete,
 * so the start of such a call is held back and its deltas are dropped; a
 * call of an unknown tool passes through unchanged.
 */
export function bridgeToolStream(
  stream: ReadableStream<TextStreamPart<ToolSet>>,
  bridged: ReadonlySet<string>,
): ReadableStream<TextStreamPart<ToolSet>> {
  const held = new Map<string, TextStreamPart<ToolSet>>();
  const names = new Map<string, string>();
  return stream.pipeThrough(
    new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      transform(part, controller) {
        switch (part.type) {
          case "tool-input-start":
            if (part.toolName === CALL_TOOL_TOOL_NAME) {
              held.set(part.id, part);
              return;
            }
            break;
          case "tool-input-delta":
          case "tool-input-end":
            if (held.has(part.id)) return;
            break;
          case "tool-call": {
            if (part.toolName !== CALL_TOOL_TOOL_NAME) break;
            const start = held.get(part.toolCallId);
            held.delete(part.toolCallId);
            const call = bridgedCall(part.input, bridged);
            if (call) names.set(part.toolCallId, call.name);
            if (start) {
              controller.enqueue(
                call && start.type === "tool-input-start"
                  ? { ...start, toolName: call.name }
                  : start,
              );
              controller.enqueue({ type: "tool-input-end", id: part.toolCallId });
            }
            if (call) {
              controller.enqueue({
                ...part,
                toolName: call.name,
                input: call.params,
              });
              return;
            }
            break;
          }
          case "tool-result":
          case "tool-error": {
            const name = names.get(part.toolCallId);
            if (name) {
              controller.enqueue({
                ...part,
                toolName: name,
                input: bridgedCall(part.input, bridged)?.params ?? {},
              } as TextStreamPart<ToolSet>);
              return;
            }
            break;
          }
          default:
            break;
        }
        controller.enqueue(part);
      },
    }),
  );
}

/**
 * The reverse, for replaying a conversation to a model: a stored call of a
 * skill tool becomes the `call_tool` call the model made, since that is the
 * only tool in its list.
 */
export function withBridgedToolCalls(
  messages: UIMessage[],
  bridged: ReadonlySet<string>,
): UIMessage[] {
  if (bridged.size === 0) return messages;
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      const name = part.type.startsWith("tool-") ? part.type.slice(5) : null;
      if (!name || !bridged.has(name)) return part;
      changed = true;
      const { input, ...rest } = part as typeof part & { input?: unknown };
      return {
        ...rest,
        type: CALL_TOOL_PART_TYPE,
        input: { tool_name: name, params: input ?? {} },
      } as UIMessage["parts"][number];
    });
    return changed ? { ...message, parts } : message;
  });
}
