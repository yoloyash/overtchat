"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentWorkspaceGitStatus } from "@/lib/agents/types";
import { agentWorkspaceKeys } from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return new Error(data?.error ?? `HTTP ${response.status}`);
}

async function fetchAgentWorkspaceGitStatus(
  id: string,
): Promise<AgentWorkspaceGitStatus> {
  const response = await fetch(
    `/api/agent-workspaces/${encodeURIComponent(id)}/git-status`,
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { status: AgentWorkspaceGitStatus })
    .status;
}

export function useAgentWorkspaceGitStatus(
  id: string,
  {
    active = false,
    running = false,
  }: { active?: boolean; running?: boolean } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.gitStatus(id),
    queryFn: () => fetchAgentWorkspaceGitStatus(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 4_000,
    refetchInterval: running ? 2_000 : active ? 5_000 : false,
  });
}
