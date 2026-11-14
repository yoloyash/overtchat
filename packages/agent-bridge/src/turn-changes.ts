import { z } from "zod";

/** The most files one turn lists; `total` still counts every changed file. */
export const AGENT_TURN_CHANGES_MAX_FILES = 200;

const count = z.number().int().nonnegative();
const objectId = z.string().regex(/^[0-9a-f]{40,64}$/);

const agentTurnChangedFileSchema = z.object({
  /** Relative to the repository root. */
  path: z.string().min(1),
  /** The path this file was renamed from. */
  previousPath: z.string().min(1).optional(),
  /** Binary files count no lines. */
  additions: count,
  deletions: count,
});

export const agentTurnChangesSchema = z.object({
  /** The snapshot commits the turn's changes lie between. */
  base: objectId,
  head: objectId,
  files: z.array(agentTurnChangedFileSchema).max(AGENT_TURN_CHANGES_MAX_FILES),
  total: z.object({ files: count, additions: count, deletions: count }),
});

export type AgentTurnChangedFile = z.infer<typeof agentTurnChangedFileSchema>;

/** What one turn changed in its workspace's Git working tree. */
export type AgentTurnChanges = z.infer<typeof agentTurnChangesSchema>;

export const AGENT_TURN_CHANGES_EVENT = "overtchat_turn_changes";

/**
 * A turn's changes ride in the transcript as a hidden custom row, which
 * clients that predate them already skip.
 */
export function agentTurnChangesRow(
  changes: AgentTurnChanges,
  timestamp: number,
): Record<string, unknown> {
  return {
    role: "custom",
    customType: AGENT_TURN_CHANGES_EVENT,
    display: false,
    timestamp,
    changes,
  };
}

export function isAgentTurnChangesRow(message: unknown): boolean {
  return (
    !!message &&
    typeof message === "object" &&
    Reflect.get(message, "role") === "custom" &&
    Reflect.get(message, "customType") === AGENT_TURN_CHANGES_EVENT
  );
}

export function agentTurnChangesOf(message: unknown): AgentTurnChanges | null {
  if (!isAgentTurnChangesRow(message)) return null;
  const parsed = agentTurnChangesSchema.safeParse(
    Reflect.get(message as object, "changes"),
  );
  return parsed.success ? parsed.data : null;
}
