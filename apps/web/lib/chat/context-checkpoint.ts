import { createHash } from "node:crypto";
import type { UIMessage } from "ai";

export interface ContextCheckpoint {
  version: 1;
  summary: string;
  boundaryMessageId: string;
  prefixHash: string;
}

function prefixHash(messages: UIMessage[]): string {
  const hash = createHash("sha256");
  for (const { id, role, parts } of messages) {
    hash.update(JSON.stringify([id, role, parts]));
  }
  return hash.digest("hex");
}

export function createContextCheckpoint(
  messages: UIMessage[],
  boundaryMessageId: string,
  summary: string,
): ContextCheckpoint {
  const boundary = messages.findIndex(
    (message) => message.id === boundaryMessageId,
  );
  if (boundary < 1 || messages[boundary].role !== "user") {
    throw new Error("Invalid context checkpoint boundary");
  }
  return {
    version: 1,
    summary,
    boundaryMessageId,
    prefixHash: prefixHash(messages.slice(0, boundary)),
  };
}

/** Checkpoints live in assistant metadata; canonical messages are never replaced.
 * Edits/regeneration remove later checkpoints with their messages. The hash also
 * rejects checkpoints whose covered prefix changed in temporary/imported chats.
 */
export function restoreContextCheckpoint(messages: UIMessage[]): {
  messages: UIMessage[];
  checkpoint?: ContextCheckpoint;
} {
  for (let owner = messages.length - 1; owner >= 0; owner--) {
    const metadata = messages[owner].metadata as
      Record<string, unknown> | undefined;
    const value = metadata?.contextCheckpoint as
      Partial<ContextCheckpoint> | undefined;
    if (
      messages[owner].role !== "assistant" ||
      value?.version !== 1 ||
      typeof value.summary !== "string" ||
      !value.summary.trim() ||
      typeof value.boundaryMessageId !== "string" ||
      typeof value.prefixHash !== "string"
    )
      continue;
    const boundary = messages.findIndex(
      (message) => message.id === value.boundaryMessageId,
    );
    if (
      boundary < 1 ||
      boundary > owner ||
      messages[boundary].role !== "user" ||
      prefixHash(messages.slice(0, boundary)) !== value.prefixHash
    )
      continue;
    return {
      messages: [
        ...messages
          .slice(0, boundary)
          .filter((message) => message.role === "system"),
        ...messages.slice(boundary),
      ],
      checkpoint: value as ContextCheckpoint,
    };
  }
  return { messages };
}
