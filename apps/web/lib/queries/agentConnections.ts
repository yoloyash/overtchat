"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddAgentWorkspaceInput,
  AgentConnectionDraft,
  AgentConnectionListItem,
  AgentConnectionProbe,
  AgentDirectoryListing,
  AgentReadyConnectionProbe,
  AgentWorkspaceListItem,
} from "@/lib/agents/types";
import { agentConnectionKeys } from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return new Error(data?.error ?? `HTTP ${response.status}`);
}

async function fetchAgentConnections(): Promise<AgentConnectionListItem[]> {
  const response = await fetch("/api/agent-connections");
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as {
    connections: AgentConnectionListItem[];
  };
  return data.connections;
}

export function useAgentConnections() {
  return useQuery({
    queryKey: agentConnectionKeys.list(),
    queryFn: fetchAgentConnections,
  });
}

export function useAgentDirectories(
  connectionId: string,
  path: string,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.directories(connectionId, path),
    queryFn: async (): Promise<AgentDirectoryListing> => {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(
        `/api/agent-connections/${connectionId}/directories${query}`,
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        directory: AgentDirectoryListing;
      }).directory;
    },
    enabled: enabled && Boolean(connectionId),
    retry: false,
  });
}

export function useProbeAgentConnection() {
  return useMutation({
    mutationFn: async (
      draft: AgentConnectionDraft,
    ): Promise<AgentConnectionProbe> => {
      const response = await fetch("/api/agent-connections/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as {
        probe: AgentConnectionProbe;
      };
      return data.probe;
    },
  });
}

export function useCreateAgentConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      draft: AgentConnectionDraft,
    ): Promise<AgentConnectionListItem> => {
      const response = await fetch("/api/agent-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as {
        connection: AgentConnectionListItem;
      };
      return data.connection;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useTestAgentConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AgentReadyConnectionProbe> => {
      const response = await fetch(`/api/agent-connections/${id}`, {
        method: "POST",
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        probe: AgentReadyConnectionProbe;
      }).probe;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useDeleteAgentConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/agent-connections/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useCreateAgentWorkspace(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AddAgentWorkspaceInput,
    ): Promise<AgentWorkspaceListItem> => {
      const response = await fetch(
        `/api/agent-connections/${connectionId}/workspaces`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        workspace: AgentWorkspaceListItem;
      }).workspace;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useRefreshAgentWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/agent-workspaces/${id}`, {
        method: "POST",
      });
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useDeleteAgentWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/agent-workspaces/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useCreateAgentSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: string): Promise<string> => {
      const response = await fetch(
        `/api/agent-workspaces/${workspaceId}/sessions`,
        { method: "POST" },
      );
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { session: { id: string } };
      return data.session.id;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}
