"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AgentWorkspaceDirectoryListing,
  AgentWorkspaceFilePreview,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
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
    enabled = true,
    active = false,
    running = false,
  }: { enabled?: boolean; active?: boolean; running?: boolean } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.gitStatus(id),
    queryFn: () => fetchAgentWorkspaceGitStatus(id),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: 4_000,
    refetchInterval: enabled
      ? running
        ? 2_000
        : active
          ? 5_000
          : false
      : false,
  });
}

async function fetchAgentWorkspaceDirectory(
  id: string,
  path: string,
): Promise<AgentWorkspaceDirectoryListing> {
  const params = new URLSearchParams({ path });
  const response = await fetch(
    `/api/agent-workspaces/${encodeURIComponent(id)}/files?${params}`,
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as {
    listing: AgentWorkspaceDirectoryListing;
  }).listing;
}

export function useAgentWorkspaceDirectory(
  id: string,
  path: string,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.directory(id, path),
    queryFn: () => fetchAgentWorkspaceDirectory(id, path),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: 4_000,
  });
}

async function fetchAgentWorkspaceFile(
  id: string,
  path: string,
): Promise<AgentWorkspaceFilePreview> {
  const params = new URLSearchParams({ path });
  const response = await fetch(
    `/api/agent-workspaces/${encodeURIComponent(id)}/file?${params}`,
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { file: AgentWorkspaceFilePreview }).file;
}

export function useAgentWorkspaceFile(
  id: string,
  path: string | null,
  { enabled = true, running = false } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.file(id, path ?? ""),
    queryFn: () => fetchAgentWorkspaceFile(id, path!),
    enabled: Boolean(id && path) && enabled,
    retry: false,
    staleTime: running ? 1_000 : 4_000,
    refetchInterval: enabled && running && path ? 2_000 : false,
  });
}
