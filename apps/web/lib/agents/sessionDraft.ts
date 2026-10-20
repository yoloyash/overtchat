export {
  resolveAgentSessionDraftSelection,
  type AgentSessionDraftSelection,
} from "@overtchat/shared/agent-creation";

export const AGENT_MODEL_DEFAULTS_LOADING_MESSAGE =
  "Model defaults are still loading";

export function agentSessionDraftRestoreKey(sessionId: string): string {
  return `overtchat:agent-fork-draft:${sessionId}`;
}

export function agentForkDraftKey(id: string): string {
  return `overtchat:agent-fork-context:${id}`;
}
