import {
  agentAttentionSections as sharedAgentAttentionSections,
  type AgentAttentionEntry,
  type AgentAttentionSectionsOf,
} from "@overtchat/shared/agent-attention";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import type { AgentWorkspaceGroup } from "@/lib/agents/workspaces";

// The state derivation is shared with the mobile client so every list files
// a session the same way; this module binds it to the web's workspace groups.
export {
  AGENT_ATTENTION_SECTIONS,
  AGENT_SESSION_STATE_LABELS,
  agentAttentionCounts,
  agentSessionActivityAt,
  agentSessionCanToggleRead,
  agentSessionHasUnseenTurn,
  agentSessionNeedsOwner,
  agentSessionState,
  agentSessionStateSince,
  formatAgentSessionAge,
  formatAgentWorkingTime,
  mostUrgentAgentSessionState,
  type AgentAttentionCounts,
  type AgentAttentionSectionKey,
  type AgentSessionState,
} from "@overtchat/shared/agent-attention";

export type AgentAttentionItem = AgentAttentionEntry<AgentWorkspaceGroup>;

/** The status groups, in the order the sidebar lists them. */
export type AgentAttentionSections = AgentAttentionSectionsOf<AgentWorkspaceGroup>;

/** Every session filed by what it needs from its owner, newest first. */
export function agentAttentionSections(
  groups: readonly AgentWorkspaceGroup[],
  providerFilter: AgentProviderId | null = null,
): AgentAttentionSections {
  return sharedAgentAttentionSections(groups, providerFilter);
}
