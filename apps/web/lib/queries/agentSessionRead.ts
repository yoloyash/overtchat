"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import { apiError } from "@overtchat/shared";
import { agentSessionHasUnseenTurn } from "@/lib/agents/attention";
import { withAgentSessionReadState } from "@/lib/agents/sidebar";
import { apiUrl } from "@/lib/api-url";
import { useAgentConnections } from "@/lib/queries/agentConnections";
import { agentConnectionKeys } from "@/lib/queries/keys";

type ReadChange = { sessionId: string; read: boolean };

async function putAgentSessionRead({ sessionId, read }: ReadChange) {
  const response = await fetch(apiUrl(`/api/agent-sessions/${sessionId}/read`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read }),
  });
  if (!response.ok) {
    throw apiError(
      response.status,
      await response.json().catch(() => null),
      "The session's read state could not be saved.",
    );
  }
}

/** Marks a session's latest finished turn read or unread. */
export function useSetAgentSessionRead() {
  const queryClient = useQueryClient();
  const apply = ({ sessionId, read }: ReadChange) =>
    queryClient.setQueryData<AgentConnectionListItem[]>(
      agentConnectionKeys.list(),
      (current) =>
        current ? withAgentSessionReadState(current, sessionId, read) : current,
    );
  return useMutation({
    mutationFn: putAgentSessionRead,
    onMutate: async (change) => {
      // A list fetched before the change would undo it.
      await queryClient.cancelQueries({ queryKey: agentConnectionKeys.list() });
      apply(change);
    },
    onSuccess: (_result, change) => apply(change),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: agentConnectionKeys.list() }),
  });
}

/** The session as the session list reports it, including live state. */
export function useAgentSessionListItem(
  sessionId: string,
): AgentSessionListItem | undefined {
  const { data } = useAgentConnections();
  for (const connection of data ?? []) {
    for (const workspace of connection.workspaces) {
      const session = workspace.sessions.find((item) => item.id === sessionId);
      if (session) return session;
    }
  }
  return undefined;
}

/**
 * Marks each turn of the open session read once it ends while the page is
 * visible. Marking it unread holds until the session is opened again.
 */
export function useMarkAgentSessionSeen(sessionId: string) {
  const session = useAgentSessionListItem(sessionId);
  const { mutate } = useSetAgentSessionRead();
  const unseenEndedAt =
    session && agentSessionHasUnseenTurn(session)
      ? session.lastTurn!.endedAt
      : null;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (unseenEndedAt === null) return;
    const key = `${sessionId}:${unseenEndedAt}`;
    const mark = () => {
      if (
        document.visibilityState !== "visible" ||
        markedRef.current === key
      ) {
        return;
      }
      markedRef.current = key;
      mutate(
        { sessionId, read: true },
        {
          onError: () => {
            markedRef.current = null;
          },
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [mutate, sessionId, unseenEndedAt]);
}
