import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import * as Network from "expo-network";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AgentConnectionListItem,
  AgentProviderCatalog,
  AgentProviderId,
  AgentSessionReplica,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
import type {
  AgentSessionCommand,
  AgentUsageSnapshot,
  AgentProviderNotice,
} from "@overtchat/agent-bridge";
import { getApiBase } from "@/lib/api";
import { agentFetch, agentJson } from "@/lib/agents/api";
import { AgentSessionStream, type StreamStatus } from "@/lib/agents/stream";
import { queryKeys } from "./keys";

export function useAgentForeground() {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => listener.remove();
  }, []);
  return focused && active;
}

export function useAgentConnections() {
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const active = useAgentForeground();
  const query = useQuery({
    queryKey: queryKeys.agentConnections(getApiBase()),
    queryFn: async ({ signal }) =>
      (
        await agentJson<{ connections: AgentConnectionListItem[] }>(
          "/api/agent-connections",
          undefined,
          signal,
        )
      ).connections,
    enabled: active,
    refetchInterval: active ? 5000 : false,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (active) void refetch();
  }, [active, refetch]);
  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, [refetch]);
  return { ...query, refreshing, refresh };
}

export function useAgentSession(id: string) {
  const active = useAgentForeground();
  const queryClient = useQueryClient();
  const server = getApiBase();
  const key = queryKeys.agentSession(server, id);
  const query = useQuery<AgentSessionReplica>({
    queryKey: key,
    // The stream owns hydration and reconciliation; this query only observes
    // its cache writes. Explicitly skip fetching instead of omitting queryFn.
    queryFn: skipToken,
  });
  const stream = useRef<AgentSessionStream | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!active) {
      setStatus("paused");
      return;
    }
    const client = new AgentSessionStream({
      id,
      initial: queryClient.getQueryData(queryKeys.agentSession(server, id)),
      request: (path, signal) =>
        agentFetch(path, { signal, cache: "no-store" }),
      onReplica: (replica) =>
        queryClient.setQueryData(queryKeys.agentSession(server, id), replica),
      onStatus: (next, message) => {
        setStatus(next);
        setError(message);
      },
    });
    stream.current = client;
    client.start();
    let previousNetwork:
      | { available: boolean; type?: Network.NetworkStateType }
      | undefined;
    const listener = Network.addNetworkStateListener((state) => {
      // Native capability/path updates can repeatedly report the same online
      // network. They are not evidence that our live SSE connection was lost.
      if (state.isConnected === undefined) return;
      const available = state.isConnected && state.isInternetReachable !== false;
      const type =
        state.type && state.type !== "UNKNOWN" && state.type !== "NONE"
          ? state.type
          : previousNetwork?.type;
      const changed =
        previousNetwork &&
        available &&
        (!previousNetwork.available ||
          (type && previousNetwork.type && type !== previousNetwork.type));
      previousNetwork = { available, type };
      if (changed) client.reconnect();
    });
    return () => {
      listener.remove();
      client.stop();
      stream.current = null;
    };
  }, [id, server, active, queryClient]);
  return {
    snapshot: query.data?.snapshot,
    status,
    error,
    reconnect: () => stream.current?.reconnect(),
  };
}

export function useAgentCatalog(workspace: string, provider: AgentProviderId) {
  return useQuery({
    queryKey: queryKeys.agentCatalog(getApiBase(), workspace, provider),
    queryFn: ({ signal }) =>
      agentJson<AgentProviderCatalog>(
        `/api/agent-workspaces/${encodeURIComponent(workspace)}/catalog?provider=${provider}`,
        undefined,
        signal,
      ),
    enabled: !!workspace,
    staleTime: 30_000,
    retry: false,
  });
}

export type AgentCommandResult = {
  sessionId?: string;
  draft?: string;
  usage?: AgentUsageSnapshot;
  notice?: AgentProviderNotice;
};

export function useAgentCommand(id: string) {
  const client = useQueryClient();
  const server = getApiBase();
  return useMutation({
    mutationFn: async (command: AgentSessionCommand) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 150_000);
      try {
        return await agentJson<AgentCommandResult>(
          `/api/agent-sessions/${encodeURIComponent(id)}`,
          command,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    retry: false,
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.agentConnections(server),
      });
    },
  });
}

export function useAgentGitStatus(workspace: string) {
  const active = useAgentForeground();
  return useQuery({
    queryKey: queryKeys.agentGitStatus(getApiBase(), workspace),
    queryFn: async ({ signal }) =>
      (
        await agentJson<{ status: AgentWorkspaceGitStatus }>(
          `/api/agent-workspaces/${encodeURIComponent(workspace)}/git-status`,
          undefined,
          signal,
        )
      ).status,
    enabled: !!workspace && active,
    staleTime: 30_000,
    refetchInterval: active ? 30_000 : false,
    retry: false,
  });
}
