import { i18n } from "./i18n/i18n";
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
      error: part.errorText || i18n.t("chat.steps.memory.toolFailed"),
    };
  }

  if (part.state === "output-denied") {
    return {
      action,
      status: "error",
      key,
      value,
      error: i18n.t("chat.steps.memory.denied"),
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
      error: error ?? i18n.t("chat.steps.memory.updateFailed"),
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
    return i18n.t(
      detail.action === "set"
        ? "chat.steps.memory.status.updating"
        : "chat.steps.memory.status.removing",
    );
  }
  if (detail.status === "error") return i18n.t("chat.steps.memory.status.failed");
  if (detail.status === "missing") {
    return i18n.t("chat.steps.memory.status.notFound");
  }
  if (detail.status === "incomplete") {
    return i18n.t("chat.steps.memory.status.incomplete");
  }
  return i18n.t(
    detail.action === "set"
      ? "chat.steps.memory.status.updated"
      : "chat.steps.memory.status.removed",
  );
}

export function memoryToolArtifactLabel(
  details: readonly MemoryToolDisplay[],
): string {
  if (details.some((detail) => detail.status === "running")) {
    if (details.length > 1) {
      return i18n.t("chat.steps.memory.artifact.updatingMany");
    }
    return i18n.t(
      details[0]?.action === "delete"
        ? "chat.steps.memory.artifact.removingOne"
        : "chat.steps.memory.artifact.updatingOne",
    );
  }
  if (details.some((detail) => detail.status === "error")) {
    return i18n.t(
      details.some((detail) => detail.status === "success")
        ? "chat.steps.memory.artifact.updatedWithErrors"
        : "chat.steps.memory.artifact.updateFailed",
    );
  }
  if (details.every((detail) => detail.status === "missing")) {
    return i18n.t(
      details.length > 1
        ? "chat.steps.memory.artifact.notFoundMany"
        : "chat.steps.memory.artifact.notFoundOne",
    );
  }
  if (details.some((detail) => detail.status === "incomplete")) {
    return i18n.t("chat.steps.memory.artifact.incomplete");
  }
  if (details.length > 1) {
    return i18n.t(
      details.every((detail) => detail.action === "delete")
        ? "chat.steps.memory.artifact.removedMany"
        : "chat.steps.memory.artifact.updatedMany",
    );
  }
  return i18n.t(
    details[0]?.action === "delete"
      ? "chat.steps.memory.artifact.removedOne"
      : "chat.steps.memory.artifact.updatedOne",
  );
}
