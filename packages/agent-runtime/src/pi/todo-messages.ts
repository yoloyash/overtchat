import type { AgentRuntimeEvent } from "../providers/types";

export type TaskList = {
  type: "taskList";
  id: string;
  items: Array<{ id: string; step: string; status: "pending" | "in_progress" | "completed" }>;
};

export type TodoParser = (details: unknown, id: string) => TaskList | null;

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Only successful, recognized native results become structured task lists.
 * Retain native text and details for durable replay and diagnostic inspection. */
export function normalizeTodoMessage(message: unknown, parse: TodoParser): unknown {
  const record = recordOf(message);
  if (record?.role !== "toolResult" || record.toolName !== "todo" ||
      typeof record.toolCallId !== "string" || record.isError === true) return message;
  const tasks = parse(record.details, `tasks:${record.toolCallId}`);
  if (!tasks) return message;
  const content = Array.isArray(record.content) ? record.content
    : typeof record.content === "string" ? [{ type: "text", text: record.content }] : [];
  return { ...record, content: [...content.filter((part) => recordOf(part)?.type !== "taskList"), tasks] };
}

export function normalizeTodoEvent(event: AgentRuntimeEvent, parse: TodoParser): AgentRuntimeEvent {
  if (event.type === "message_end") {
    const message = normalizeTodoMessage(event.message, parse);
    return message === event.message ? event : { ...event, message };
  }
  if (event.type !== "tool_execution_end" || event.isError === true) return event;
  const result = recordOf(event.result);
  if (!result) return event;
  const message = { ...result, role: "toolResult", toolName: event.toolName, toolCallId: event.toolCallId };
  const normalized = normalizeTodoMessage(message, parse);
  return normalized === message ? event : { type: "message_end", message: normalized };
}
