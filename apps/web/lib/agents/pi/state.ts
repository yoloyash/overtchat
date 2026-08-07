import type {
  AgentQueuedMessage,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";

type AgentRuntimeEvent = Extract<
  AgentRuntimeEnvelope,
  { type: "runtime_event" }
>["data"];

function roleOf(message: unknown): string | null {
  return message && typeof message === "object"
    ? ((Reflect.get(message, "role") as string | undefined) ?? null)
    : null;
}

function toolCallIdOf(message: unknown): string | null {
  return message && typeof message === "object"
    ? ((Reflect.get(message, "toolCallId") as string | undefined) ?? null)
    : null;
}

function timestampOf(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;
  const timestamp = Reflect.get(message, "timestamp");
  return typeof timestamp === "number" ? timestamp : null;
}

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = Reflect.get(message, "content");
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      Reflect.get(part, "type") === "text" &&
      typeof Reflect.get(part, "text") === "string"
        ? [Reflect.get(part, "text") as string]
        : [],
    )
    .join("\n")
    .trim();
}

function submissionIdOf(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const id = Reflect.get(message, "overtchatSubmissionId");
  return typeof id === "string" ? id : null;
}

function upsertMessage(messages: unknown[], message: unknown): unknown[] {
  const role = roleOf(message);
  if (!role) return messages;
  const next = [...messages];
  if (role === "user") {
    const text = textOf(message);
    const pendingIndex = next.findIndex(
      (candidate) =>
        roleOf(candidate) === "user" &&
        submissionIdOf(candidate) !== null &&
        textOf(candidate) === text,
    );
    if (pendingIndex >= 0) {
      next[pendingIndex] = message;
      return next;
    }
  }
  const timestamp = timestampOf(message);
  if (timestamp !== null) {
    const index = next.findIndex(
      (candidate) =>
        roleOf(candidate) === role && timestampOf(candidate) === timestamp,
    );
    if (index >= 0) {
      next[index] = message;
      return next;
    }
  }
  if (role === "assistant") {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (roleOf(next[index]) === "assistant") {
        next[index] = message;
        return next;
      }
      if (roleOf(next[index]) !== null) break;
    }
  }
  if (role === "toolResult") {
    const toolCallId = toolCallIdOf(message);
    if (toolCallId) {
      const index = next.findIndex(
        (candidate) =>
          roleOf(candidate) === "toolResult" &&
          toolCallIdOf(candidate) === toolCallId,
      );
      if (index >= 0) {
        next[index] = message;
        return next;
      }
    }
  }
  next.push(message);
  return next;
}

function partialToolResult(event: Record<string, unknown>): unknown | null {
  if (
    typeof event.toolCallId !== "string" ||
    typeof event.toolName !== "string"
  ) {
    return null;
  }
  const result =
    event.type === "tool_execution_update"
      ? event.partialResult
      : event.type === "tool_execution_end"
        ? event.result
        : null;
  if (!result || typeof result !== "object") return null;
  return {
    role: "toolResult",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    content: Reflect.get(result, "content") ?? [],
    isError: event.type === "tool_execution_end" && event.isError === true,
    timestamp: Date.now(),
    overtchatPartial: event.type === "tool_execution_update",
  };
}

export function applyAgentRuntimeMessageEvent(
  messages: unknown[],
  event: AgentRuntimeEvent,
): unknown[] {
  if (
    event.type === "overtchat_submission" &&
    event.message !== undefined
  ) {
    return upsertMessage(messages, event.message);
  }
  if (
    event.type === "overtchat_submission_rejected" &&
    typeof event.id === "string"
  ) {
    return messages.filter(
      (message) => submissionIdOf(message) !== event.id,
    );
  }
  if (
    ["message_start", "message_update", "message_end"].includes(event.type) &&
    event.message !== undefined
  ) {
    return upsertMessage(messages, event.message);
  }
  if (
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    const message = partialToolResult(event);
    return message ? upsertMessage(messages, message) : messages;
  }
  if (event.type === "command_output" && typeof event.text === "string") {
    return [
      ...messages,
      {
        role: "custom",
        content: event.text,
        display: true,
        timestamp: Date.now(),
      },
    ];
  }
  return messages;
}

export function applyAgentRuntimeStateEvent(
  state: Record<string, unknown>,
  event: AgentRuntimeEvent,
): Record<string, unknown> {
  if (event.type === "compaction_start") {
    return { ...state, isCompacting: true };
  }
  if (event.type === "compaction_end") {
    return { ...state, isCompacting: false };
  }
  return state;
}

export function applyAgentRuntimeEnvelope(
  current: AgentRuntimeSnapshot | undefined,
  envelope: AgentRuntimeEnvelope,
): AgentRuntimeSnapshot | undefined {
  if (envelope.type === "snapshot") return envelope.data;
  if (!current) return current;
  const event = envelope.data;

  if (event.type === "agent_start" || event.type === "turn_start") {
    return {
      ...current,
      status: "running",
      activeTurn: current.activeTurn ?? { startedAt: Date.now() },
      state: { ...current.state, isStreaming: true },
      error: undefined,
    };
  }
  if (
    event.type === "overtchat_status" &&
    (event.status === "idle" || event.status === "running")
  ) {
    return {
      ...current,
      status: event.status,
      activeTurn:
        event.status === "running"
          ? (current.activeTurn ?? {
              startedAt:
                typeof event.startedAt === "number"
                  ? event.startedAt
                  : Date.now(),
            })
          : null,
      state: {
        ...current.state,
        isStreaming: event.status === "running",
        ...(event.status === "idle" ? { isCompacting: false } : {}),
      },
      ...(event.status === "running" ? { error: undefined } : {}),
    };
  }
  if (
    event.type === "rpc_error" &&
    typeof event.error === "string"
  ) {
    return { ...current, error: event.error };
  }
  if (event.type === "overtchat_queue_update") {
    const queuedMessages = parseQueuedMessages(event.queuedMessages);
    if (!queuedMessages) return current;
    return {
      ...current,
      queuedMessages,
    };
  }
  if (
    event.type === "overtchat_submission" ||
    event.type === "overtchat_submission_rejected"
  ) {
    return {
      ...current,
      messages: applyAgentRuntimeMessageEvent(current.messages, event),
    };
  }
  if (event.type === "process_exit") {
    return {
      ...current,
      status: "exited",
      activeTurn: null,
      state: {
        ...current.state,
        isStreaming: false,
        isCompacting: false,
      },
      error:
        typeof event.error === "string"
          ? event.error
          : `The ${agentProviderMetadata(current.provider).label} process exited.`,
    };
  }
  if (
    ["message_start", "message_update", "message_end"].includes(event.type) &&
    event.message !== undefined
  ) {
    return {
      ...current,
      messages: applyAgentRuntimeMessageEvent(current.messages, event),
    };
  }
  if (
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    const messages = applyAgentRuntimeMessageEvent(current.messages, event);
    return messages === current.messages ? current : { ...current, messages };
  }
  if (event.type === "command_output" && typeof event.text === "string") {
    return {
      ...current,
      messages: applyAgentRuntimeMessageEvent(current.messages, event),
    };
  }
  if (event.type === "compaction_start" || event.type === "compaction_end") {
    return {
      ...current,
      state: applyAgentRuntimeStateEvent(current.state, event),
    };
  }
  if (
    event.type === "extension_ui_request" &&
    typeof event.id === "string" &&
    typeof event.method === "string" &&
    ["select", "confirm", "input", "editor"].includes(event.method)
  ) {
    return {
      ...current,
      pendingExtensionRequest:
        event as AgentRuntimeSnapshot["pendingExtensionRequest"],
    };
  }
  return current;
}

function parseQueuedMessages(value: unknown): AgentQueuedMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: AgentQueuedMessage[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof Reflect.get(item, "id") !== "string" ||
      typeof Reflect.get(item, "message") !== "string" ||
      !["pending", "sending"].includes(
        String(Reflect.get(item, "status")),
      )
    ) {
      return null;
    }
    messages.push({
      id: Reflect.get(item, "id") as string,
      message: Reflect.get(item, "message") as string,
      status: Reflect.get(item, "status") as "pending" | "sending",
    });
  }
  return messages;
}
