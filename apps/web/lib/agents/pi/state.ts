import type {
  AgentQueuedMessage,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";

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

function upsertMessage(messages: unknown[], message: unknown): unknown[] {
  const role = roleOf(message);
  if (!role) return messages;
  const next = [...messages];
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
      state: {
        ...current.state,
        isStreaming: event.status === "running",
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
  if (event.type === "process_exit") {
    return {
      ...current,
      status: "exited",
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
      messages: upsertMessage(current.messages, event.message),
    };
  }
  if (
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    const message = partialToolResult(event);
    return message
      ? {
          ...current,
          messages: upsertMessage(current.messages, message),
        }
      : current;
  }
  if (event.type === "command_output" && typeof event.text === "string") {
    return {
      ...current,
      messages: [
        ...current.messages,
        {
          role: "custom",
          content: event.text,
          display: true,
          timestamp: Date.now(),
        },
      ],
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
      typeof Reflect.get(item, "message") !== "string"
    ) {
      return null;
    }
    messages.push({
      id: Reflect.get(item, "id") as string,
      message: Reflect.get(item, "message") as string,
    });
  }
  return messages;
}
