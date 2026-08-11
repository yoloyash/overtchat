export const AGENT_SEND_BEHAVIOR_STORAGE_KEY =
  "overtchat_agent_send_behavior";

export const DEFAULT_AGENT_SEND_BEHAVIOR = "steer" as const;

export type AgentSendBehavior = "steer" | "queue";

export function resolveAgentSendDelivery({
  running,
  supportsSteer,
  behavior,
  alternate = false,
}: {
  running: boolean;
  supportsSteer: boolean;
  behavior: AgentSendBehavior;
  alternate?: boolean;
}): "prompt" | "queue" | "steer" {
  if (!running) return "prompt";
  if (!supportsSteer) return "queue";
  const preferred = behavior === "queue" ? "queue" : "steer";
  if (!alternate) return preferred;
  return preferred === "queue" ? "steer" : "queue";
}
