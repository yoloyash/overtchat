/** Server-emitted progress; transient chunks never replace chat messages. */
export const CONTEXT_STATUS_DATA_TYPE = "data-context-status";
export type ContextStatus =
  | "compacting"
  | "compacted"
  | "manual-compacting"
  | "manual-compacted";

export function isContextStatus(value: unknown): value is ContextStatus {
  return (
    value === "compacting" ||
    value === "compacted" ||
    value === "manual-compacting" ||
    value === "manual-compacted"
  );
}

export function contextStatusLabel(status: ContextStatus): string {
  if (status === "compacting") return "Auto compacting…";
  if (status === "manual-compacting") return "Compacting…";
  if (status === "manual-compacted") return "Compacted";
  return "Auto compacted";
}

/** A manual checkpoint is a transcript marker, with no model-authored answer. */
export function isManualCompactionMessage(message: {
  metadata?: unknown;
}): boolean {
  const status = (message.metadata as { contextStatus?: unknown } | undefined)
    ?.contextStatus;
  return status === "manual-compacting" || status === "manual-compacted";
}
