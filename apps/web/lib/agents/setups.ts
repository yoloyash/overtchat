import type {
  AgentConnectionListItem,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import { agentSessionActivityAt } from "@/lib/agents/attention";

/** An agent and workspace a new session can start with. */
export type AgentSetup = {
  workspaceId: string;
  provider: AgentProviderId;
  workspaceName: string;
  workspacePath: string;
  hostLabel: string;
  transport: AgentConnectionListItem["host"]["transport"];
  /** Latest activity of the setup's sessions; 0 when it has none. */
  activityAt: number;
};

/**
 * Every setup, most recently used first. Setups without sessions follow in
 * list order, so a fresh install still opens its first workspace.
 */
export function recentAgentSetups(
  connections: readonly AgentConnectionListItem[],
): AgentSetup[] {
  const setups: AgentSetup[] = [];
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      setups.push({
        workspaceId: workspace.id,
        provider: connection.provider,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        hostLabel: connection.host.sshAlias || connection.host.name,
        transport: connection.host.transport,
        activityAt: Math.max(
          0,
          ...workspace.sessions.map(agentSessionActivityAt),
        ),
      });
    }
  }
  // Array sort is stable, so equal activity keeps list order.
  return setups.sort((left, right) => right.activityAt - left.activityAt);
}

/** Each workspace name once, in the order its setups were last used. */
export function agentSetupWorkspaceNames(
  setups: readonly AgentSetup[],
): string[] {
  return Array.from(new Set(setups.map((setup) => setup.workspaceName)));
}

export type AgentSetupHostGroup = {
  hostLabel: string;
  setups: AgentSetup[];
};

/**
 * The setups that have a workspace of this name, grouped by host. Hosts and
 * the setups within them keep the order they were last used.
 */
export function agentSetupsByHost(
  setups: readonly AgentSetup[],
  workspaceName: string,
): AgentSetupHostGroup[] {
  const groups: AgentSetupHostGroup[] = [];
  for (const setup of setups) {
    if (setup.workspaceName !== workspaceName) continue;
    const group = groups.find((item) => item.hostLabel === setup.hostLabel);
    if (group) group.setups.push(setup);
    else groups.push({ hostLabel: setup.hostLabel, setups: [setup] });
  }
  return groups;
}
