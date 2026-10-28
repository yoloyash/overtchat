"use client";

import type { AgentNotification } from "./agentNotification";

export type AgentStreamEvent =
  | { type: "open" }
  | { type: "notification"; notification: AgentNotification };

const listeners = new Set<(event: AgentStreamEvent) => void>();

/** What the agent event stream reports beyond session state. */
export function subscribeAgentStream(
  listener: (event: AgentStreamEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAgentStream(event: AgentStreamEvent): void {
  for (const listener of listeners) listener(event);
}

let clientId: string | undefined;

/**
 * This page load's id for presence heartbeats and the event stream. A new id
 * per load keeps a closed page from standing in for the next one.
 */
export function agentClientId(): string {
  clientId ??= crypto.randomUUID();
  return clientId;
}
