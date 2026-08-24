"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentQueuedMessage,
  AgentProviderNotice,
  AgentRuntimeSnapshot,
  AgentSessionSync,
  AgentSessionCommand,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import {
  isAgentRuntimeEnvelope,
  isAgentSessionSync,
} from "@overtchat/agent-bridge";
import {
  applyEnvelopeToReplica,
  applyLegacyEnvelopeToReplica,
  applySyncToReplica,
  formatAgentRuntimeCursor,
  replicaFromOpenResult,
  resolveAgentSessionFetchRace,
  type AgentSessionOpenResult,
  type AgentSessionReplica,
} from "@/lib/agents/sessionReplica";
import {
  agentConnectionKeys,
  agentSessionKeys,
} from "@/lib/queries/keys";

class AgentSessionHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentSessionHttpError";
  }
}

async function responseError(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return new AgentSessionHttpError(
    data?.error ?? `HTTP ${response.status}`,
    response.status,
  );
}

function isRetryableSessionOpenError(error: unknown): boolean {
  if (error instanceof AgentSessionHttpError) {
    return (
      error.status === 400 ||
      error.status === 408 ||
      error.status === 409 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return error instanceof TypeError;
}

async function fetchAgentSession(
  id: string,
  current?: AgentSessionReplica,
): Promise<AgentSessionReplica> {
  const after = current?.cursor
    ? `?after=${encodeURIComponent(formatAgentRuntimeCursor(current.cursor))}`
    : "";
  const response = await fetch(`/api/agent-sessions/${id}${after}`, {
    cache: "no-store",
  });
  if (!response.ok) throw await responseError(response);
  const data = (await response.json()) as {
    snapshot?: AgentRuntimeSnapshot;
    sync?: unknown;
  };
  if (data.snapshot?.sessionId !== id) {
    throw new Error("The Host Connector opened a different session.");
  }
  let sync: AgentSessionSync | undefined;
  if (data.sync !== undefined) {
    if (!isAgentSessionSync(data.sync)) {
      throw new Error("The Host Connector returned an invalid session sync.");
    }
    sync = data.sync;
  }
  const result: AgentSessionOpenResult = {
    snapshot: data.snapshot,
    ...(sync ? { sync } : {}),
  };
  return replicaFromOpenResult(result, current);
}

export function useAgentSession(id: string) {
  const queryClient = useQueryClient();
  const replicaRef = useRef<AgentSessionReplica | null>(null);
  const initialRetryRef = useRef({ id, attempt: 0 });
  const [streamStatus, setStreamStatus] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const query = useQuery<
    AgentSessionReplica,
    Error,
    AgentRuntimeSnapshot
  >({
    queryKey: agentSessionKeys.detail(id),
    queryFn: async () => {
      const cached = queryClient.getQueryData<AgentSessionReplica>(
        agentSessionKeys.detail(id),
      );
      const baseline =
        cached?.snapshot.sessionId === id
          ? cached
          : replicaRef.current?.snapshot.sessionId === id
            ? replicaRef.current
            : undefined;
      const fetched = await fetchAgentSession(id, baseline);
      const latestCached = queryClient.getQueryData<AgentSessionReplica>(
        agentSessionKeys.detail(id),
      );
      const latest =
        latestCached?.snapshot.sessionId === id
          ? latestCached
          : replicaRef.current?.snapshot.sessionId === id
            ? replicaRef.current
            : null;
      return resolveAgentSessionFetchRace(baseline, latest, fetched);
    },
    select: (replica) => replica.snapshot,
    retry: false,
  });

  const sessionReady = query.data !== undefined;
  const retryError = query.error;
  const retryErrorUpdatedAt = query.errorUpdatedAt;
  const retryIsError = query.isError;
  const retryRefetch = query.refetch;
  useEffect(() => {
    if (initialRetryRef.current.id !== id) {
      initialRetryRef.current = { id, attempt: 0 };
    }
    if (sessionReady) {
      initialRetryRef.current.attempt = 0;
      return;
    }
    if (!retryIsError || !isRetryableSessionOpenError(retryError)) return;

    const attempt = initialRetryRef.current.attempt++;
    const delay = Math.min(1_000 * 2 ** attempt, 30_000);
    const timer = setTimeout(() => {
      void retryRefetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [
    id,
    retryError,
    retryErrorUpdatedAt,
    retryIsError,
    retryRefetch,
    sessionReady,
  ]);

  useEffect(() => {
    const replica = queryClient.getQueryData<AgentSessionReplica>(
      agentSessionKeys.detail(id),
    );
    if (replica?.snapshot.sessionId === id) {
      replicaRef.current = replica;
    }
  }, [id, query.dataUpdatedAt, queryClient]);

  useEffect(() => {
    if (!sessionReady) return;
    const initial = queryClient.getQueryData<AgentSessionReplica>(
      agentSessionKeys.detail(id),
    );
    if (!initial) return;
    if (replicaRef.current?.snapshot.sessionId !== id) {
      replicaRef.current = initial;
    }

    let stopped = false;
    let events: EventSource | null = null;
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    let reconcileAttempt = 0;
    let reconciling = false;

    const commit = (replica: AgentSessionReplica) => {
      if (stopped) return;
      replicaRef.current = replica;
      queryClient.setQueryData<AgentSessionReplica>(
        agentSessionKeys.detail(id),
        replica,
      );
    };

    const closeEvents = () => {
      events?.close();
      events = null;
    };

    const scheduleReconciliation = () => {
      if (stopped || reconcileTimer) return;
      const delay = Math.min(1_000 * 2 ** reconcileAttempt++, 30_000);
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        void reconcile();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      closeEvents();
      const cursor = replicaRef.current?.cursor;
      const params = new URLSearchParams({ sync: "1" });
      if (cursor) {
        params.set("after", formatAgentRuntimeCursor(cursor));
      }
      const source = new EventSource(
        `/api/agent-sessions/${id}/events?${params.toString()}`,
      );
      events = source;
      source.onopen = () => {
        if (!stopped && events === source) setStreamStatus("connected");
      };
      source.onerror = () => {
        if (stopped || events !== source) return;
        closeEvents();
        void reconcile();
      };
      source.addEventListener("sync", (event) => {
        if (stopped || events !== source) return;
        let sync: unknown;
        try {
          sync = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          void reconcile();
          return;
        }
        if (!isAgentSessionSync(sync)) {
          void reconcile();
          return;
        }
        const current = replicaRef.current ?? undefined;
        const next = applySyncToReplica(current, sync);
        if (!next) {
          void reconcile();
          return;
        }
        commit(next);
        void queryClient.invalidateQueries({
          queryKey: agentConnectionKeys.list(),
        });
      });
      const applyRuntimeEvent = (event: Event, legacy: boolean) => {
        if (stopped || events !== source) return;
        let envelope: unknown;
        try {
          envelope = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          void reconcile();
          return;
        }
        if (!isAgentRuntimeEnvelope(envelope)) {
          void reconcile();
          return;
        }
        const current = replicaRef.current;
        if (!current) {
          void reconcile();
          return;
        }
        const update = legacy
          ? applyLegacyEnvelopeToReplica(current, envelope)
          : applyEnvelopeToReplica(current, envelope);
        if (update.type === "reconcile") {
          void reconcile();
          return;
        }
        if (update.type === "duplicate") return;
        commit(update.replica);
        if (envelope.type === "snapshot") {
          void queryClient.invalidateQueries({
            queryKey: agentConnectionKeys.list(),
          });
        }
      };
      source.addEventListener("runtime", (event) => {
        applyRuntimeEvent(event, false);
      });
      source.addEventListener("legacy-runtime", (event) => {
        applyRuntimeEvent(event, true);
      });
    };

    async function reconcile(): Promise<void> {
      if (stopped || reconciling) return;
      reconciling = true;
      closeEvents();
      setStreamStatus("reconnecting");
      try {
        const current = replicaRef.current ?? undefined;
        const next = await fetchAgentSession(id, current);
        if (stopped) return;
        commit(next);
        reconcileAttempt = 0;
        connect();
      } catch {
        scheduleReconciliation();
      } finally {
        reconciling = false;
      }
    }

    connect();
    return () => {
      stopped = true;
      closeEvents();
      if (reconcileTimer) clearTimeout(reconcileTimer);
    };
  }, [id, queryClient, sessionReady]);

  return { ...query, streamStatus };
}

export function useAgentSessionCommand(id: string) {
  const queryClient = useQueryClient();
  const retainedIdentity = useRef<{
    fingerprint: string;
    clientMessageId: string;
  } | null>(null);
  return useMutation({
    mutationFn: async (
      command: AgentSessionCommand,
    ): Promise<{
      sessionId?: string;
      draft?: string;
      queuedMessages?: AgentQueuedMessage[];
      usage?: AgentUsageSnapshot;
      notice?: AgentProviderNotice;
    }> => {
      const needsIdentity =
        (command.type === "prompt" ||
          command.type === "queue" ||
          command.type === "implement_plan") &&
        !command.clientMessageId;
      const fingerprint = needsIdentity ? JSON.stringify(command) : null;
      let generatedClientMessageId: string | null = null;
      if (fingerprint) {
        generatedClientMessageId =
          retainedIdentity.current?.fingerprint === fingerprint
            ? retainedIdentity.current.clientMessageId
            : crypto.randomUUID();
        retainedIdentity.current = {
          fingerprint,
          clientMessageId: generatedClientMessageId,
        };
      }
      const wireCommand = generatedClientMessageId
        ? { ...command, clientMessageId: generatedClientMessageId }
        : command;
      let response: Response;
      try {
        response = await fetch(`/api/agent-sessions/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(wireCommand),
        });
      } catch (cause) {
        if (generatedClientMessageId) {
          throw new Error(
            "The connection was lost while sending, so the command outcome is unknown. Inspect the session before retrying; an unchanged retry will reuse the same command identity.",
            { cause },
          );
        }
        throw cause;
      }
      if (!response.ok) throw await responseError(response);
      const result = (await response.json()) as {
        sessionId?: string;
        draft?: string;
        queuedMessages?: AgentQueuedMessage[];
        usage?: AgentUsageSnapshot;
        notice?: AgentProviderNotice;
      };
      if (
        fingerprint &&
        retainedIdentity.current?.fingerprint === fingerprint &&
        retainedIdentity.current.clientMessageId === generatedClientMessageId
      ) {
        retainedIdentity.current = null;
      }
      return result;
    },
    onSuccess: (data, command) => {
      if (data.queuedMessages) {
        queryClient.setQueryData<AgentSessionReplica>(
          agentSessionKeys.detail(id),
          (current) =>
            current
              ? {
                  ...current,
                  snapshot: {
                    ...current.snapshot,
                    queuedMessages: data.queuedMessages!,
                  },
                }
              : current,
        );
      }
      if (
        command.type === "set_model" ||
        command.type === "set_thinking_level" ||
        command.type === "set_collaboration_mode" ||
        command.type === "set_fast_mode" ||
        command.type === "set_mode" ||
        command.type === "update_goal" ||
        command.type === "implement_plan" ||
        command.type === "compact" ||
        command.type === "set_auto_compaction" ||
        command.type === "set_session_name" ||
        command.type === "new_session"
      ) {
        void queryClient.invalidateQueries({
          queryKey: agentSessionKeys.detail(id),
        });
      }
      if (
        command.type === "prompt" ||
        command.type === "implement_plan" ||
        command.type === "steer_queued_message" ||
        command.type === "set_session_name" ||
        command.type === "new_session" ||
        command.type === "edit_message" ||
        command.type === "fork_message"
      ) {
        void queryClient.invalidateQueries({
          queryKey: agentConnectionKeys.list(),
        });
      }
    },
  });
}

export function useAgentSessionUsage(id: string) {
  return useMutation({
    mutationFn: async (): Promise<AgentUsageSnapshot> => {
      const response = await fetch(`/api/agent-sessions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "show_usage" }),
      });
      if (!response.ok) throw await responseError(response);
      const result = (await response.json()) as {
        usage?: AgentUsageSnapshot;
      };
      if (!result.usage) {
        throw new Error("The Host Connector did not return account usage.");
      }
      return result.usage;
    },
  });
}
