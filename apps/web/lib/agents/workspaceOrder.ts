import type { AgentWorkspaceGroup } from "./workspaces";

export function agentWorkspaceOrderStorageKey(
  userId: string,
  serverOrigin: string,
) {
  return `overtchat_agent_workspace_order:${JSON.stringify([serverOrigin, userId])}`;
}

/** Saved groups first; new groups retain their incoming order at the end. */
export function orderAgentWorkspaces(
  groups: AgentWorkspaceGroup[],
  savedOrder: unknown,
): AgentWorkspaceGroup[] {
  if (!Array.isArray(savedOrder)) return groups;
  const remaining = new Map(groups.map((group) => [group.key, group]));
  const ordered: AgentWorkspaceGroup[] = [];
  for (const key of savedOrder) {
    if (typeof key !== "string") continue;
    const group = remaining.get(key);
    if (!group) continue;
    ordered.push(group);
    remaining.delete(key);
  }
  return [...ordered, ...remaining.values()];
}
