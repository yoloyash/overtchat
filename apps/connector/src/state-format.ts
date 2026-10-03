import { agentPromptImageSchema, isAgentDaemonSessionDescriptor, type AgentDaemonSessionDescriptor, type AgentQueuedMessage } from "@overtchat/agent-bridge";

export type CachedCommandResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

export type CommandJournalEntry =
  | {
      commandId: string;
      sessionId: string;
      fingerprint: string;
      status: "pending";
    }
  | {
      commandId: string;
      sessionId: string | null;
      fingerprint: string | null;
      status: "completed";
      result: CachedCommandResult;
    };

export type BeginCommandResult =
  | { status: "execute" }
  | { status: "pending" }
  | { status: "completed"; result: CachedCommandResult };

export type SessionState = {
  descriptor: AgentDaemonSessionDescriptor;
  queuedMessages: AgentQueuedMessage[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isQueuedMessage(value: unknown): value is AgentQueuedMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.message === "string" &&
    (value.status === "pending" ||
      value.status === "sending" ||
      value.status === "uncertain") &&
    (value.images === undefined ||
      (Array.isArray(value.images) &&
        value.images.every((image) => agentPromptImageSchema.safeParse(image).success)))
  );
}

export function isCommandResult(value: unknown): value is CachedCommandResult {
  return (
    isRecord(value) &&
    ((value.success === true && "data" in value) ||
      (value.success === false && typeof value.error === "string"))
  );
}

export function stableCommandResult(result: CachedCommandResult): CachedCommandResult {
  if (!result.success) return { success: false, error: result.error };
  if (!isRecord(result.data)) return { success: true, data: result.data };
  // Queue state is a mutable projection and is already persisted in the
  // session journal/timeline. Replaying old snapshots from the command ledger
  // can resurrect drained messages and made v0.2 journals grow quadratically.
  const stable = { ...result.data };
  delete stable.snapshot;
  return { success: true, data: stable };
}

export function isCommandIdentity(
  commandId: string,
  sessionId: string,
  fingerprint: string,
): boolean {
  return (
    commandId.length > 0 &&
    sessionId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(fingerprint)
  );
}

export function isCommandEntry(value: unknown): value is CommandJournalEntry {
  if (
    !isRecord(value) ||
    typeof value.commandId !== "string" ||
    !value.commandId
  ) {
    return false;
  }
  if (value.status === "pending") {
    return (
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      typeof value.fingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(value.fingerprint)
    );
  }
  return (
    value.status === "completed" &&
    (value.sessionId === null ||
      (typeof value.sessionId === "string" && value.sessionId.length > 0)) &&
    (value.fingerprint === null ||
      (typeof value.fingerprint === "string" &&
        /^[a-f0-9]{64}$/u.test(value.fingerprint))) &&
    ((value.sessionId === null && value.fingerprint === null) ||
      (typeof value.sessionId === "string" &&
        typeof value.fingerprint === "string")) &&
    isCommandResult(value.result)
  );
}


export function isSessionState(value: unknown, sessionId: string): value is SessionState {
  return isRecord(value) && isAgentDaemonSessionDescriptor(value.descriptor) &&
    value.descriptor.sessionId === sessionId && Array.isArray(value.queuedMessages) &&
    value.queuedMessages.every(isQueuedMessage);
}
