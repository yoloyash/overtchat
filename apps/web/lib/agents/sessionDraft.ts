import type { AgentProviderId } from "@overtchat/agent-bridge";
export {
  resolveAgentSessionDraftSelection,
  type AgentSessionDraftSelection,
} from "@overtchat/shared/agent-creation";

export const AGENT_MODEL_DEFAULTS_LOADING_MESSAGE =
  "Model defaults are still loading";

export function newAgentSessionHref(
  workspaceId: string,
  provider: AgentProviderId,
): string {
  const query = new URLSearchParams({ workspaceId, provider });
  return `/agents/new?${query.toString()}`;
}

export function agentSessionDraftRestoreKey(sessionId: string): string {
  return `overtchat:agent-fork-draft:${sessionId}`;
}
