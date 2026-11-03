import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import * as Network from "expo-network";
import {
  isAgentHistoryPage,
  prependAgentHistoryPage,
} from "@overtchat/agent-bridge";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderCatalog,
  AgentProviderId,
  AgentProviderSnapshot,
  AgentRuntimeStatus,
  AgentSessionReplica,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
import type {
  AgentSessionCommand,
  AgentUsageSnapshot,
  AgentProviderNotice,
} from "@overtchat/agent-bridge";
import { withAgentSessionReadState } from "@overtchat/shared/agent-attention";
import { getApiBase } from "@/lib/api";
import { agentFetch, agentJson } from "@/lib/agents/api";
import { AgentSessionStream, type StreamStatus } from "@/lib/agents/stream";
import { findAgentSession, groupWorkspaces } from "@/lib/agents/workspaces";
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

type ReadChange = { sessionId: string; read: boolean };

async function putAgentSessionRead({ sessionId, read }: ReadChange) {
  await agentFetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/read`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read }),
  });
}

/**
 * Marks a session's latest finished turn read or unread. The session list
 * moves at once so the drawer follows the tap, and is refetched if the server
 * refuses.
 */
export function useSetAgentSessionRead() {
  const queryClient = useQueryClient();
  const key = queryKeys.agentConnections(getApiBase());
  const apply = ({ sessionId, read }: ReadChange) =>
    queryClient.setQueryData<AgentConnectionListItem[]>(key, (current) =>
      current ? withAgentSessionReadState(current, sessionId, read) : current,
    );
  return useMutation({
    mutationFn: putAgentSessionRead,
    retry: false,
    onMutate: async (change) => {
      // A list fetched before the change would undo it.
      await queryClient.cancelQueries({ queryKey: key });
      apply(change);
    },
    onSuccess: (_result, change) => apply(change),
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/**
 * Tells the server the owner has seen the session: when it opens in the
 * foreground, and whenever a turn ends while it is open.
 */
export function useMarkAgentSessionSeen(
  id: string,
  status: AgentRuntimeStatus | undefined,
) {
  const active = useAgentForeground();
  const queryClient = useQueryClient();
  const key = queryKeys.agentConnections(getApiBase());
  useEffect(() => {
    if (!active || status === undefined || status === "running") return;
    void putAgentSessionRead({ sessionId: id, read: true })
      .then(() => {
        // The drawer's list follows without waiting for its next poll.
        queryClient.setQueryData<AgentConnectionListItem[]>(key, (current) =>
          current ? withAgentSessionReadState(current, id, true) : current,
        );
      })
      .catch(() => {
        // Servers that predate read state answer 404; nothing to show.
      });
    // The key only changes with the server, which remounts the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, active, status, queryClient]);
}

/**
 * Asks the connector to reconcile every workspace's sessions, then refreshes
 * the list. Failures for single workspaces come back as messages.
 */
export function useSyncAgentWorkspaces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { result } = await agentJson<{
        result: { failures: { message: string }[] };
      }>("/api/agent-workspaces/sync", {});
      return result;
    },
    retry: false,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentConnections(getApiBase()),
      }),
  });
}

async function fetchAgentConnections({ signal }: { signal: AbortSignal }) {
  return (
    await agentJson<{ connections: AgentConnectionListItem[] }>(
      "/api/agent-connections",
      undefined,
      signal,
    )
  ).connections;
}

/**
 * One session's folder and list entry, read from the shared connection list
 * without polling it. Fetches once when nothing is cached yet, such as after
 * opening a notification.
 */
export function useAgentSessionListing(id: string) {
  const foreground = useAgentForeground();
  const query = useQuery({
    queryKey: queryKeys.agentConnections(getApiBase()),
    queryFn: fetchAgentConnections,
    enabled: foreground,
    staleTime: Infinity,
    retry: false,
    select: (connections) => findAgentSession(groupWorkspaces(connections), id),
  });
  return query.data ?? null;
}

export function useAgentConnections({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const foreground = useAgentForeground();
  const active = foreground && enabled;
  const query = useQuery({
    queryKey: queryKeys.agentConnections(getApiBase()),
    queryFn: fetchAgentConnections,
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
  const history = useMutation({
    mutationFn: async () => {
      const current = queryClient.getQueryData<AgentSessionReplica>(key);
      const before = current?.snapshot.history?.beforeCursor;
      if (!before) return;
      const response = await agentFetch(
        `/api/agent-sessions/${encodeURIComponent(id)}?before=${encodeURIComponent(before)}`,
        { cache: "no-store" },
      );
      const page: unknown = await response.json();
      if (!isAgentHistoryPage(page) || page.sessionId !== id)
        throw new Error("Invalid agent history page.");
      queryClient.setQueryData<AgentSessionReplica>(key, (latest) => {
        if (!latest) return latest;
        const next = prependAgentHistoryPage(latest, page);
        stream.current?.updateReplica(next);
        return next;
      });
    },
  });
  return {
    snapshot: query.data?.snapshot,
    status,
    error,
    reconnect: () => stream.current?.reconnect(),
    history,
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
  forkContext?: import("@overtchat/agent-bridge").AgentForkContext;
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

/**
 * Which agents the machine has, as the connector last detected them. The
 * connector keeps the answer until something asks it to look again.
 */
export function useAgentProviderSnapshot(target: AgentDiscoveryTarget | null) {
  return useQuery({
    queryKey: queryKeys.agentProviderSnapshot(
      getApiBase(),
      JSON.stringify(target),
    ),
    queryFn: async ({ signal }) =>
      (
        await agentJson<{ snapshot: AgentProviderSnapshot }>(
          "/api/agent-connections/discover?refresh=0",
          target,
          signal,
        )
      ).snapshot,
    enabled: target !== null,
    staleTime: 60_000,
    retry: false,
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
