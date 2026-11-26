import type { TFunction } from "i18next";
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
  t: TFunction,
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
      error: part.errorText || t("chat.steps.memory.toolFailed"),
    };
  }

  if (part.state === "output-denied") {
    return {
      action,
      status: "error",
      key,
      value,
      error: t("chat.steps.memory.denied"),
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
      error: error ?? t("chat.steps.memory.updateFailed"),
    };
  }

  return { action, status: "incomplete", key, value };
}

export function hasSuccessfulMemoryMutation(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      isMemoryToolPart(part) &&
      part.state === "output-available" &&
      record(part.output)?.ok === true,
  );
}

export function memoryToolStatusLabel(
  detail: MemoryToolDisplay,
  t: TFunction,
): string {
  if (detail.status === "running") {
    return t(
      detail.action === "set"
        ? "common.states.updating"
        : "common.states.removing",
    );
  }
  if (detail.status === "error") return t("chat.steps.memory.status.failed");
  if (detail.status === "missing") {
    return t("chat.steps.memory.status.notFound");
  }
  if (detail.status === "incomplete") {
    return t("chat.steps.memory.status.incomplete");
  }
  return t(
    detail.action === "set"
      ? "chat.steps.memory.status.updated"
      : "chat.steps.memory.status.removed",
  );
}

export function memoryToolArtifactLabel(
  details: readonly MemoryToolDisplay[],
  t: TFunction,
): string {
  if (details.some((detail) => detail.status === "running")) {
    if (details.length > 1) {
      return t("chat.steps.memory.artifact.updatingMany");
    }
    return t(
      details[0]?.action === "delete"
        ? "chat.steps.memory.artifact.removingOne"
        : "chat.steps.memory.artifact.updatingOne",
    );
  }
  if (details.some((detail) => detail.status === "error")) {
    return t(
      details.some((detail) => detail.status === "success")
        ? "chat.steps.memory.artifact.updatedWithErrors"
        : "chat.steps.memory.artifact.updateFailed",
    );
  }
  if (details.every((detail) => detail.status === "missing")) {
    return t(
      details.length > 1
        ? "chat.steps.memory.artifact.notFoundMany"
        : "chat.steps.memory.artifact.notFoundOne",
    );
  }
  if (details.some((detail) => detail.status === "incomplete")) {
    return t("chat.steps.memory.artifact.incomplete");
  }
  if (details.length > 1) {
    return t(
      details.every((detail) => detail.action === "delete")
        ? "chat.steps.memory.artifact.removedMany"
        : "chat.steps.memory.artifact.updatedMany",
    );
  }
  return t(
    details[0]?.action === "delete"
      ? "chat.steps.memory.artifact.removedOne"
      : "chat.steps.memory.artifact.updatedOne",
  );
}
