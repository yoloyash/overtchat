"use client";

import { useLocalStorage } from "@/lib/useLocalStorage";

/** How the agents sidebar groups sessions: by what they need, or by folder. */
export type AgentSidebarGrouping = "status" | "workspace";

/** Kept per device, like other sidebar view preferences. */
export const AGENT_SIDEBAR_GROUPING_KEY = "overtchat:agent-sidebar-grouping";

export function useAgentSidebarGrouping(): [
  AgentSidebarGrouping,
  (grouping: AgentSidebarGrouping) => void,
] {
  const [stored, setStored] = useLocalStorage<unknown>(
    AGENT_SIDEBAR_GROUPING_KEY,
    "status",
  );
  return [stored === "workspace" ? "workspace" : "status", setStored];
}
