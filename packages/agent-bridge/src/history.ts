import type { AgentSessionLaunchConfig } from "./agents";

export type AgentForkContext = {
  text: string;
  launchConfig: AgentSessionLaunchConfig;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function agentForkMessageId(message: unknown, index: number): string {
  const row = record(message);
  const id = row.overtchatTurnBoundaryId ?? row.id ?? row.messageId;
  return typeof id === "string"
    ? id
    : `history:${index}:${String(row.timestamp ?? "")}`;
}

export function agentPromptWithHistory(
  message: string,
  history?: string,
): string {
  const result = history ? `${history}\n\n${message}` : message;
  if (result.length > 200_000)
    throw new Error(
      "The message and attached history exceed the message limit.",
    );
  return result;
}
