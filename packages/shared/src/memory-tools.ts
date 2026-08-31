import type { UIMessage } from "ai";

type MessagePart = UIMessage["parts"][number];

export type MemoryToolPart = MessagePart & {
  type: "tool-set_memory" | "tool-delete_memory";
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type MemoryToolDisplay = {
  action: "set" | "delete";
  status: "running" | "success" | "error" | "missing" | "incomplete";
  key?: string;
  value?: string;
  error?: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

export function isMemoryToolPart(part: MessagePart): part is MemoryToolPart {
  return part.type === "tool-set_memory" || part.type === "tool-delete_memory";
}

export function describeMemoryToolPart(
  part: MemoryToolPart,
): MemoryToolDisplay {
  const action = part.type === "tool-set_memory" ? "set" : "delete";
  const input = record(part.input);
  const output = record(part.output);
  const key = stringField(output, "key") ?? stringField(input, "key");
  const value =
    action === "set"
      ? stringField(output, "value") ?? stringField(input, "value")
      : undefined;

  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  ) {
    return { action, status: "running", key, value };
  }

  if (part.state === "output-error") {
    return {
      action,
      status: "error",
      key,
      value,
      error: part.errorText || "The memory tool failed.",
    };
  }

  if (part.state === "output-denied") {
    return {
      action,
      status: "error",
      key,
      value,
      error: "The memory change was denied.",
    };
  }

  if (part.state === "output-available") {
    if (output?.ok === true) {
      return { action, status: "success", key, value };
    }
    const error = stringField(output, "error");
    if (action === "delete" && output?.ok === false && !error) {
      return { action, status: "missing", key };
    }
    return {
      action,
      status: "error",
      key,
      value,
      error: error ?? "The memory could not be updated.",
    };
  }

  return { action, status: "incomplete", key, value };
}

export function hasSuccessfulMemoryMutation(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      isMemoryToolPart(part) &&
      describeMemoryToolPart(part).status === "success",
  );
}

export function memoryToolStatusLabel(detail: MemoryToolDisplay): string {
  if (detail.status === "running") {
    return detail.action === "set" ? "Updating…" : "Removing…";
  }
  if (detail.status === "error") return "Failed";
  if (detail.status === "missing") return "Not found";
  if (detail.status === "incomplete") return "Did not complete";
  return detail.action === "set" ? "Updated" : "Removed";
}

export function memoryToolArtifactLabel(
  details: readonly MemoryToolDisplay[],
): string {
  if (details.some((detail) => detail.status === "running")) {
    if (details.length > 1) return "Updating memories…";
    return details[0]?.action === "delete"
      ? "Removing memory…"
      : "Updating memory…";
  }
  if (details.some((detail) => detail.status === "error")) {
    return details.some((detail) => detail.status === "success")
      ? "Memories updated with errors"
      : "Memory update failed";
  }
  if (details.every((detail) => detail.status === "missing")) {
    return details.length > 1 ? "Memories not found" : "Memory not found";
  }
  if (details.some((detail) => detail.status === "incomplete")) {
    return "Memory update did not complete";
  }
  if (details.length > 1) {
    return details.every((detail) => detail.action === "delete")
      ? "Memories removed"
      : "Memories updated";
  }
  return details[0]?.action === "delete" ? "Memory removed" : "Memory updated";
}
