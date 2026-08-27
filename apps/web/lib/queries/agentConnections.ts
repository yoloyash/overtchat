"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentDirectoryListing,
  AgentReadyConnectionProbe,
  AgentProviderCatalog,
  AgentProviderId,
  AgentProviderSnapshot,
  AgentSessionDirectoryEntry,
  AgentSessionLaunchConfig,
  AgentSshHostCandidate,
  DetectedAgentInstallation,
  HostConnectorListItem,
  HostConnectorPairing,
} from "@overtchat/agent-bridge";
import { isAgentSessionDirectoryEntry } from "@overtchat/agent-bridge";
import { agentConnectionKeys } from "@/lib/queries/keys";
import {
  agentConnectionHasRunningSession,
  withAgentSessionDirectory,
} from "@/lib/agents/sidebar";

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
    refetchInterval: (query) =>
      query.state.data?.some(agentConnectionHasRunningSession)
        ? 2_000
        : false,
  });
}

export function useAgentConnectionSessionDirectory(
  connections: AgentConnectionListItem[],
) {
  const queryClient = useQueryClient();
  const sessionFingerprint = connections
    .flatMap((connection) =>
      connection.workspaces.flatMap((workspace) =>
        workspace.sessions.map((session) => session.id),
      ),
    )
    .sort()
    .join("\n");
  useEffect(() => {
    if (!sessionFingerprint) return;
    const source = new EventSource("/api/agent-connections/events");
    const parseEvent = (event: Event): unknown => {
      try {
        return JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return null;
      }
    };
    const applySessions = (sessions: AgentSessionDirectoryEntry[]) => {
      queryClient.setQueryData<AgentConnectionListItem[]>(
        agentConnectionKeys.list(),
        (current) =>
          current ? withAgentSessionDirectory(current, sessions) : current,
      );
    };
    const receiveSnapshot = (event: Event) => {
      const value = parseEvent(event);
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const sessions = Reflect.get(value, "sessions");
      if (
        !Array.isArray(sessions) ||
        !sessions.every(isAgentSessionDirectoryEntry)
      ) {
        return;
      }
      applySessions(sessions);
    };
    const receiveUpdate = (event: Event) => {
      const value = parseEvent(event);
      if (!isAgentSessionDirectoryEntry(value)) return;
      applySessions([value]);
    };
    source.addEventListener("snapshot", receiveSnapshot);
    source.addEventListener("update", receiveUpdate);
    return () => {
      source.removeEventListener("snapshot", receiveSnapshot);
      source.removeEventListener("update", receiveUpdate);
      source.close();
    };
  }, [queryClient, sessionFingerprint]);
}

export function useHostConnectors() {
  return useQuery({
    queryKey: agentConnectionKeys.connectors(),
    queryFn: async (): Promise<HostConnectorListItem[]> => {
      const response = await fetch("/api/host-connectors");
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        connectors: HostConnectorListItem[];
      }).connectors;
    },
    refetchInterval: 5_000,
  });
}

export function useCreateHostConnectorPairing() {
  return useMutation({
    mutationFn: async (): Promise<HostConnectorPairing> => {
      const response = await fetch("/api/host-connectors", { method: "POST" });
      if (!response.ok) throw await responseError(response);
      return (await response.json()) as HostConnectorPairing;
    },
  });
}

export function useDeleteHostConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        `/api/host-connectors?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: agentConnectionKeys.all(),
      }),
  });
}

export function useAgentSshHosts(
  connectorId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.sshHosts(connectorId ?? ""),
    queryFn: async (): Promise<AgentSshHostCandidate[]> => {
      const response = await fetch(
        `/api/agent-connections/ssh-hosts?connectorId=${encodeURIComponent(
          connectorId ?? "",
        )}`,
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        hosts: AgentSshHostCandidate[];
      }).hosts;
    },
    enabled: enabled && Boolean(connectorId),
    retry: false,
  });
}

export function useDetectedAgentInstallations(
  target: AgentDiscoveryTarget | null,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.discovery(
      target?.connectorId ?? "",
      target?.transport ?? "local",
      target?.transport === "ssh" ? target.sshAlias : "",
    ),
    queryFn: async (): Promise<DetectedAgentInstallation[]> => {
      if (!target) return [];
      const response = await fetch("/api/agent-connections/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        installations: DetectedAgentInstallation[];
      }).installations;
    },
    enabled: enabled && target !== null,
    retry: false,
    staleTime: 30_000,
  });
}

export function useAgentProviderSnapshot(
  target: AgentDiscoveryTarget | null,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.providerSnapshot(
      target?.connectorId ?? "",
      target?.transport ?? "local",
      target?.transport === "ssh" ? target.sshAlias : "",
    ),
    queryFn: async (): Promise<AgentProviderSnapshot> => {
      if (!target) throw new Error("Choose a machine first.");
      const response = await fetch("/api/agent-connections/discover?refresh=0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        snapshot: AgentProviderSnapshot;
      }).snapshot;
    },
    enabled: enabled && target !== null,
    retry: false,
  });
}

export function useAgentTargetDirectories(
  target: AgentDiscoveryTarget | null,
  path: string,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.targetDirectories(
      target?.connectorId ?? "",
      target?.transport ?? "local",
      target?.transport === "ssh" ? target.sshAlias : "",
      path,
    ),
    queryFn: async (): Promise<AgentDirectoryListing> => {
      if (!target) throw new Error("Choose a machine first.");
      const response = await fetch("/api/agent-connections/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, ...(path ? { path } : {}) }),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        directory: AgentDirectoryListing;
      }).directory;
    },
    enabled: enabled && target !== null,
    retry: false,
  });
}

export type ReconcileAgentWorkspaceInput = {
  target: AgentDiscoveryTarget;
  path: string;
  installations?: DetectedAgentInstallation[];
};

export type AgentWorkspaceReconcileResult = {
  providers: number;
  refreshed: number;
  created: number;
  failures: Array<{ provider: string; message: string }>;
};

export async function reconcileAgentWorkspace({
  target,
  path,
  installations,
}: ReconcileAgentWorkspaceInput): Promise<AgentWorkspaceReconcileResult> {
  const response = await fetch("/api/agent-workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      path,
      ...(installations ? { installations } : {}),
    }),
  });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { result: AgentWorkspaceReconcileResult })
    .result;
}

export function useCreateAgentWorkspaceGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reconcileAgentWorkspace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useRefreshAllAgentWorkspaces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AgentWorkspaceReconcileResult> => {
      const response = await fetch("/api/agent-workspaces/sync", {
        method: "POST",
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as {
        result: AgentWorkspaceReconcileResult;
      }).result;
    },
    onSettled: () =>
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
    mutationFn: async ({
      workspaceId,
      provider,
      launchConfig,
    }: {
      workspaceId: string;
      provider: AgentProviderId;
      launchConfig: AgentSessionLaunchConfig;
    }): Promise<string> => {
      const response = await fetch(
        `/api/agent-workspaces/${workspaceId}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, launchConfig }),
        },
      );
      if (!response.ok) throw await responseError(response);
      const data = (await response.json()) as { session: { id: string } };
      return data.session.id;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

export function useAgentWorkspaceCatalog(
  workspaceId: string | null,
  provider: AgentProviderId | null,
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.catalog(
      workspaceId ?? "",
      provider ?? "",
    ),
    queryFn: async (): Promise<AgentProviderCatalog> => {
      const response = await fetch(
        `/api/agent-workspaces/${workspaceId}/catalog?provider=${encodeURIComponent(provider ?? "")}`,
      );
      if (!response.ok) throw await responseError(response);
      return (await response.json()) as AgentProviderCatalog;
    },
    enabled: enabled && Boolean(workspaceId) && provider !== null,
    staleTime: 30_000,
  });
}
