"use client";

import { apiError } from "@overtchat/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import {
  agentWorkspaceImageMediaType,
  type AgentWorkspaceDirectoryListing,
  type AgentWorkspaceFileDiff,
  type AgentWorkspaceFilePreview,
  type AgentWorkspaceGitBranches,
  type AgentWorkspaceGitStatus,
  type AgentWorkspaceGitSwitchResult,
  type AgentWorkspaceGitSwitchTarget,
  type AgentWorkspaceGitWorktreeInspection,
} from "@overtchat/agent-bridge";
import { agentWorkspaceKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";
import {
  isAgentWorkspaceGitLive,
  subscribeAgentWorkspaceGitWatches,
  watchAgentWorkspaceGit,
} from "@/lib/queries/agentWorkspaceGitWatch";

async function responseError(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return apiError(response.status, data, "Could not complete the request. Please try again.");
}

async function fetchAgentWorkspaceGitStatus(
  id: string,
): Promise<AgentWorkspaceGitStatus> {
  const response = await fetch(
    apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/git-status`),
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
  const watching = Boolean(id) && enabled && (active || running);
  useEffect(
    () => (watching ? watchAgentWorkspaceGit(id) : undefined),
    [id, watching],
  );
  // Live workspaces receive pushed statuses; the rest keep polling.
  const live = useSyncExternalStore(
    subscribeAgentWorkspaceGitWatches,
    () => watching && isAgentWorkspaceGitLive(id),
    () => false,
  );
  return useQuery({
    queryKey: agentWorkspaceKeys.gitStatus(id),
    queryFn: () => fetchAgentWorkspaceGitStatus(id),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: live ? Infinity : 4_000,
    refetchInterval:
      enabled && !live
        ? running
          ? 2_000
          : active
            ? 5_000
            : false
        : false,
  });
}

async function fetchAgentWorkspaceGitBranches(
  id: string,
): Promise<AgentWorkspaceGitBranches> {
  const response = await fetch(
    apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/git-branches`),
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { branches: AgentWorkspaceGitBranches })
    .branches;
}

/** Branches change outside the app, so every open of the picker refetches. */
export function useAgentWorkspaceGitBranches(
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.gitBranches(id),
    queryFn: () => fetchAgentWorkspaceGitBranches(id),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: 0,
  });
}

export function useSwitchAgentWorkspaceGitBranch(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      branch: AgentWorkspaceGitSwitchTarget;
      stash?: boolean;
    }): Promise<AgentWorkspaceGitSwitchResult> => {
      const response = await fetch(
        apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/git-branches`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        result: AgentWorkspaceGitSwitchResult;
      }).result;
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentWorkspaceKeys.gitStatus(id),
        }),
        queryClient.invalidateQueries({
          queryKey: agentWorkspaceKeys.gitBranches(id),
        }),
        // Files can differ on the new branch.
        queryClient.invalidateQueries({
          queryKey: agentWorkspaceKeys.directories(id),
        }),
        queryClient.invalidateQueries({
          queryKey: [...agentWorkspaceKeys.all(), "file", id],
        }),
      ]),
  });
}

/** What removing an OvertChat worktree would discard; read fresh each time. */
export function useAgentWorktreeInspection(
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.worktree(id),
    queryFn: async (): Promise<AgentWorkspaceGitWorktreeInspection> => {
      const response = await fetch(
        apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/worktree`),
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        inspection: AgentWorkspaceGitWorktreeInspection;
      }).inspection;
    },
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

async function fetchAgentWorkspaceDirectory(
  id: string,
  path: string,
): Promise<AgentWorkspaceDirectoryListing> {
  const params = new URLSearchParams({ path });
  const response = await fetch(
    apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/files?${params}`),
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
  const params = new URLSearchParams({
    path,
    ...(agentWorkspaceImageMediaType(path) ? { images: "1" } : {}),
  });
  const response = await fetch(
    apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/file?${params}`),
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { file: AgentWorkspaceFilePreview }).file;
}

async function fetchAgentWorkspaceFileDiff(
  id: string,
  path: string,
  originalPath: string | null,
): Promise<AgentWorkspaceFileDiff> {
  const params = new URLSearchParams({
    path,
    ...(originalPath ? { originalPath } : {}),
  });
  const response = await fetch(
    apiUrl(`/api/agent-workspaces/${encodeURIComponent(id)}/file-diff?${params}`),
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { diff: AgentWorkspaceFileDiff }).diff;
}

/** One file's uncommitted changes, refreshed while the agent is working. */
export function useAgentWorkspaceFileDiff(
  id: string,
  path: string,
  originalPath: string | null,
  { enabled = true, running = false } = {},
) {
  return useQuery({
    queryKey: agentWorkspaceKeys.fileDiff(id, path),
    queryFn: () => fetchAgentWorkspaceFileDiff(id, path, originalPath),
    enabled: Boolean(id && path) && enabled,
    retry: false,
    staleTime: running ? 1_000 : 4_000,
    refetchInterval: enabled && running ? 2_000 : false,
  });
}

export function useAgentWorkspaceFile(
  id: string,
  path: string | null,
  { enabled = true, running = false } = {},
) {
  const image = path !== null && agentWorkspaceImageMediaType(path) !== null;
  return useQuery({
    queryKey: agentWorkspaceKeys.file(id, path ?? ""),
    queryFn: () => fetchAgentWorkspaceFile(id, path!),
    enabled: Boolean(id && path) && enabled,
    retry: false,
    // An image is megabytes over the connector; it reloads on request only.
    staleTime: image ? 60_000 : running ? 1_000 : 4_000,
    refetchInterval: enabled && running && path && !image ? 2_000 : false,
  });
}
