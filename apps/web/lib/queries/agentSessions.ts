"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentQueuedMessage,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@/lib/agents/types";
import { applyAgentRuntimeEnvelope } from "@/lib/agents/runtime/state";
import {
  agentConnectionKeys,
  agentSessionKeys,
} from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return new Error(data?.error ?? `HTTP ${response.status}`);
}

async function fetchAgentSession(id: string): Promise<AgentRuntimeSnapshot> {
  const response = await fetch(`/api/agent-sessions/${id}`);
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { snapshot: AgentRuntimeSnapshot })
    .snapshot;
}

export function useAgentSession(id: string) {
  const queryClient = useQueryClient();
  const [streamStatus, setStreamStatus] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const query = useQuery({
    queryKey: agentSessionKeys.detail(id),
    queryFn: () => fetchAgentSession(id),
    retry: false,
  });

  useEffect(() => {
    if (!query.isSuccess) return;
    const events = new EventSource(`/api/agent-sessions/${id}/events`);
    events.onopen = () => setStreamStatus("connected");
    events.onerror = () => setStreamStatus("reconnecting");
    events.addEventListener("runtime", (event) => {
      let envelope: AgentRuntimeEnvelope;
      try {
        envelope = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AgentRuntimeEnvelope;
      } catch {
        void queryClient.invalidateQueries({
          queryKey: agentSessionKeys.detail(id),
        });
        return;
      }
      queryClient.setQueryData<AgentRuntimeSnapshot>(
        agentSessionKeys.detail(id),
        (current) => applyAgentRuntimeEnvelope(current, envelope),
      );
      if (envelope.type === "snapshot") {
        void queryClient.invalidateQueries({
          queryKey: agentConnectionKeys.list(),
        });
      }
    });
    return () => events.close();
  }, [id, query.isSuccess, queryClient]);

  return { ...query, streamStatus };
}

export function useAgentSessionCommand(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      command: AgentSessionCommand,
    ): Promise<{
      sessionId?: string;
      queuedMessages?: AgentQueuedMessage[];
    }> => {
      const response = await fetch(`/api/agent-sessions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) throw await responseError(response);
      return (await response.json()) as {
        sessionId?: string;
        queuedMessages?: AgentQueuedMessage[];
      };
    },
    onSuccess: (data, command) => {
      if (data.queuedMessages) {
        queryClient.setQueryData<AgentRuntimeSnapshot>(
          agentSessionKeys.detail(id),
          (current) =>
            current
              ? { ...current, queuedMessages: data.queuedMessages! }
              : current,
        );
      }
      if (
        command.type === "set_model" ||
        command.type === "set_thinking_level" ||
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
        command.type === "steer" ||
        command.type === "steer_queued_message" ||
        command.type === "set_session_name" ||
        command.type === "new_session"
      ) {
        void queryClient.invalidateQueries({
          queryKey: agentConnectionKeys.list(),
        });
      }
    },
  });
}
