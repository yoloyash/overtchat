import type {
  AgentProviderId,
  AgentSessionAttention,
  AgentTurnSummary,
} from "@overtchat/agent-bridge";

export const AGENT_NOTIFICATION_REASONS = [
  "approval",
  "question",
  "completed",
  "failed",
] as const;
export type AgentNotificationReason =
  (typeof AGENT_NOTIFICATION_REASONS)[number];

/** The same words the sidebar uses for each state. */
export const AGENT_NOTIFICATION_LABELS: Record<AgentNotificationReason, string> =
  {
    approval: "Needs approval",
    question: "Has a question",
    completed: "Finished",
    failed: "Failed",
  };

/** A pending request or a finished turn, as the tracker reports it. */
export type AgentAttentionEvent = {
  sessionId: string;
  reason: AgentNotificationReason;
  /** One per request or turn, so a replay never alerts twice. */
  eventId: string;
  attention?: AgentSessionAttention;
  turn?: AgentTurnSummary;
};

/** What a web or desktop client shows when the server picks it to tell the owner. */
export type AgentNotification = {
  sessionId: string;
  reason: AgentNotificationReason;
  eventId: string;
  title: string;
  body: string;
  provider: AgentProviderId;
};

export function isAgentNotification(value: unknown): value is AgentNotification {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.sessionId === "string" &&
    item.sessionId.length > 0 &&
    AGENT_NOTIFICATION_REASONS.includes(item.reason as AgentNotificationReason) &&
    typeof item.eventId === "string" &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    typeof item.provider === "string"
  );
}

/** Whether the agent is waiting on the owner, as opposed to done. */
export function agentNotificationNeedsInput(
  reason: AgentNotificationReason,
): boolean {
  return reason === "approval" || reason === "question";
}

/**
 * The title names the state and the session, like a sidebar row; the body is
 * the request, the reply or the error, or else where the session runs.
 */
export function agentNotificationText(
  event: Pick<AgentAttentionEvent, "reason" | "attention" | "turn">,
  session: { title: string; workspaceName: string; hostName: string },
): { title: string; body: string } {
  const title = `${AGENT_NOTIFICATION_LABELS[event.reason]}: ${session.title}`;
  const place = `${session.workspaceName} · ${session.hostName}`;
  let body: string | undefined;
  if (agentNotificationNeedsInput(event.reason)) {
    const attention = event.attention;
    body = attention?.detail
      ? `${attention.title} · ${attention.detail}`
      : attention?.title;
  } else if (event.reason === "completed") {
    body = event.turn?.preview;
  } else {
    body = event.turn?.error;
  }
  return { title, body: body?.trim() || place };
}

/** How long after its last heartbeat a client still counts as present. */
export const AGENT_PRESENCE_WINDOW_MS = 180_000;
/** How often a client reports in while it can be seen. */
export const AGENT_PRESENCE_HEARTBEAT_MS = 30_000;

/** Per-device choices for web and desktop alerts, kept in local storage. */
export const AGENT_ALERT_SOUND_KEY = "overtchat:agent-alert-sound";
export const AGENT_ALERT_SYSTEM_KEY = "overtchat:agent-alert-system";
