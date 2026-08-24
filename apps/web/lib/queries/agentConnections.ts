"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentConnectionDraft,
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentDirectoryListing,
  AgentReadyConnectionProbe,
  AgentProviderCatalog,
  AgentSessionDirectoryEntry,
  AgentSessionLaunchConfig,
  AgentSshHostCandidate,
  AgentWorkspaceListItem,
  DetectedAgentInstallation,
  HostConnectorListItem,
  HostConnectorPairing,
} from "@overtchat/agent-bridge";
import { isAgentSessionDirectoryEntry } from "@overtchat/agent-bridge";
import { agentConnectionKeys } from "@/lib/queries/keys";
import {
  agentConnectionMatchesTarget,
  agentConnectionTarget,
  agentTargetKey,
  groupAgentWorkspaces,
} from "@/lib/agents/workspaces";
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

async function discoverAgentInstallations(
  target: AgentDiscoveryTarget,
): Promise<DetectedAgentInstallation[]> {
  const response = await fetch("/api/agent-connections/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as {
    installations: DetectedAgentInstallation[];
  }).installations;
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

export type CreateAgentWorkspaceSetupInput = {
  draft: AgentConnectionDraft;
  path: string;
  connection?: AgentConnectionListItem;
};

export async function createAgentWorkspaceSetup({
  draft,
  path,
  connection: existingConnection,
}: CreateAgentWorkspaceSetupInput): Promise<{
  connection: AgentConnectionListItem;
  workspace: AgentWorkspaceListItem;
}> {
  let connection = existingConnection;
  let createdConnectionId: string | null = null;

  if (!connection) {
    const response = await fetch("/api/agent-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) throw await responseError(response);
    connection = ((await response.json()) as {
      connection: AgentConnectionListItem;
    }).connection;
    createdConnectionId = connection.id;
  }

  try {
    const response = await fetch(
      `/api/agent-connections/${connection.id}/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    );
    if (!response.ok) throw await responseError(response);
    const workspace = ((await response.json()) as {
      workspace: AgentWorkspaceListItem;
    }).workspace;
    return { connection, workspace };
  } catch (error) {
    if (createdConnectionId) {
      await fetch(`/api/agent-connections/${createdConnectionId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    throw error;
  }
}

type ReconcileAgentWorkspaceInput = {
  target: AgentDiscoveryTarget;
  path: string;
  connections: AgentConnectionListItem[];
  installations?: DetectedAgentInstallation[];
};

export type AgentWorkspaceReconcileResult = {
  providers: number;
  refreshed: number;
  created: number;
  failures: Array<{ provider: string; message: string }>;
};

function draftForInstallation(
  target: AgentDiscoveryTarget,
  installation: DetectedAgentInstallation,
): AgentConnectionDraft {
  return target.transport === "local"
    ? {
        connectorId: target.connectorId,
        provider: installation.provider,
        transport: "local",
        name: "This server",
        executable: installation.executable,
      }
    : {
        connectorId: target.connectorId,
        provider: installation.provider,
        transport: "ssh",
        name: target.sshAlias.slice(0, 80),
        executable: installation.executable,
        sshAlias: target.sshAlias,
      };
}

async function refreshStoredWorkspace(id: string): Promise<void> {
  const response = await fetch(`/api/agent-workspaces/${id}`, {
    method: "POST",
  });
  if (!response.ok) throw await responseError(response);
}

export async function reconcileAgentWorkspace({
  target,
  path,
  connections,
  installations,
}: ReconcileAgentWorkspaceInput): Promise<AgentWorkspaceReconcileResult> {
  const detected = installations ?? (await discoverAgentInstallations(target));
  const matchingConnections = connections.filter((connection) =>
    agentConnectionMatchesTarget(connection, target, connection.provider),
  );
  const providers = new Map(
    detected.map((installation) => [installation.provider, installation]),
  );
  for (const connection of matchingConnections) {
    if (!providers.has(connection.provider)) {
      providers.set(connection.provider, {
        provider: connection.provider,
        executable: connection.executable,
        version: connection.detectedVersion ?? "configured",
      });
    }
  }
  if (providers.size === 0) {
    throw new Error("No supported coding agents were detected on this machine.");
  }

  const result: AgentWorkspaceReconcileResult = {
    providers: providers.size,
    refreshed: 0,
    created: 0,
    failures: [],
  };
  for (const installation of providers.values()) {
    const connection = matchingConnections.find(
      (candidate) => candidate.provider === installation.provider,
    );
    const workspace = connection?.workspaces.find(
      (candidate) => candidate.path === path,
    );
    try {
      if (workspace) {
        await refreshStoredWorkspace(workspace.id);
        result.refreshed += 1;
      } else {
        await createAgentWorkspaceSetup({
          draft: draftForInstallation(target, installation),
          path,
          connection,
        });
        result.created += 1;
      }
    } catch (error) {
      result.failures.push({
        provider: installation.provider,
        message: error instanceof Error ? error.message : "Refresh failed.",
      });
    }
  }
  if (result.refreshed + result.created === 0) {
    throw new Error(
      result.failures.map(({ message }) => message).join(" ") ||
        "The workspace could not be refreshed.",
    );
  }
  return result;
}

export async function reconcileAllAgentWorkspaces(
  connections: AgentConnectionListItem[],
): Promise<AgentWorkspaceReconcileResult> {
  const groups = groupAgentWorkspaces(connections);
  const totals: AgentWorkspaceReconcileResult = {
    providers: 0,
    refreshed: 0,
    created: 0,
    failures: [],
  };
  const discoveries = new Map<
    string,
    Promise<DetectedAgentInstallation[]>
  >();
  const current = [...connections];

  for (const group of groups) {
    const target = agentConnectionTarget(group.targets[0]!.connection);
    const key = agentTargetKey(target);
    let discovery = discoveries.get(key);
    if (!discovery) {
      discovery = discoverAgentInstallations(target);
      discoveries.set(key, discovery);
    }
    let installations: DetectedAgentInstallation[] | undefined;
    try {
      installations = await discovery;
    } catch (error) {
      totals.failures.push({
        provider: "discovery",
        message:
          error instanceof Error ? error.message : "Agent discovery failed.",
      });
    }
    let result: AgentWorkspaceReconcileResult;
    try {
      result = await reconcileAgentWorkspace({
        target,
        path: group.path,
        connections: current,
        installations: installations ?? [],
      });
    } catch (error) {
      totals.failures.push({
        provider: "workspace",
        message:
          error instanceof Error
            ? `${group.name}: ${error.message}`
            : `${group.name}: refresh failed.`,
      });
      continue;
    }
    totals.providers += result.providers;
    totals.refreshed += result.refreshed;
    totals.created += result.created;
    totals.failures.push(...result.failures);

    if (result.created > 0) {
      const latest = await fetchAgentConnections();
      current.splice(0, current.length, ...latest);
    }
  }
  return totals;
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
    mutationFn: reconcileAllAgentWorkspaces,
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
      launchConfig,
    }: {
      workspaceId: string;
      launchConfig: AgentSessionLaunchConfig;
    }): Promise<string> => {
      const response = await fetch(
        `/api/agent-workspaces/${workspaceId}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(launchConfig),
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
  enabled = true,
) {
  return useQuery({
    queryKey: agentConnectionKeys.catalog(workspaceId ?? ""),
    queryFn: async (): Promise<AgentProviderCatalog> => {
      const response = await fetch(`/api/agent-workspaces/${workspaceId}/catalog`);
      if (!response.ok) throw await responseError(response);
      return (await response.json()) as AgentProviderCatalog;
    },
    enabled: enabled && Boolean(workspaceId),
    staleTime: 30_000,
  });
}
