"use client";

import { createContext, useContext } from "react";

export type AgentWorkspaceFileSelection = {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  gitIgnored?: boolean;
};

type AgentWorkspaceNavigation = {
  openFile: (selection: AgentWorkspaceFileSelection) => void;
};

const AgentWorkspaceNavigationContext =
  createContext<AgentWorkspaceNavigation | null>(null);

export const AgentWorkspaceNavigationProvider =
  AgentWorkspaceNavigationContext.Provider;

export function useAgentWorkspaceNavigation(): AgentWorkspaceNavigation | null {
  return useContext(AgentWorkspaceNavigationContext);
}
