"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChatGenerationState } from "@overtchat/shared";
import type { UIMessage } from "ai";

const POLL_DELAY_MS = 1_500;

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function applyTerminalMessage(
  current: UIMessage[],
  responseMessage: UIMessage | undefined,
) {
  if (!responseMessage) return current;
  const index = current.findIndex(({ id }) => id === responseMessage.id);
  if (index === -1) return [...current, responseMessage];
  const next = [...current];
  next[index] = responseMessage;
  return next;
}

/**
 * Reconciles the mounted transport with the server-owned generation. Mobile
 * browsers can leave a dead fetch looking open, so server status—not the local
 * reader—is authoritative after mount, foreground, and network restoration.
 */
export function useChatGenerationRecovery({
  chatId,
  enabled,
  recoverOnMount,
  stopLocalStream,
  resumeStream,
  clearError,
  setMessages,
  onSettled,
}: {
  chatId: string;
  enabled: boolean;
  recoverOnMount: boolean;
  stopLocalStream: () => void;
  resumeStream: () => Promise<void>;
  clearError: () => void;
  setMessages: (
    messages: UIMessage[] | ((current: UIMessage[]) => UIMessage[]),
  ) => void;
  onSettled: () => void;
}) {
  const epochRef = useRef(0);
  const recoveryRef = useRef<Promise<void> | null>(null);

  const reconcile = useCallback(async () => {
    if (!enabled) return;
    if (recoveryRef.current) return recoveryRef.current;

    const epoch = epochRef.current;
    const recovery = (async () => {
      while (epochRef.current === epoch) {
        const response = await fetch(
          `/api/chat/${encodeURIComponent(chatId)}/stream/status`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`Could not inspect generation (${response.status})`);
        }
        const generation = (await response.json()) as ChatGenerationState;

        if (!generation.active) {
          setMessages((current) =>
            applyTerminalMessage(current, generation.responseMessage),
          );
          clearError();
          onSettled();
          return;
        }

        // This only aborts the stale client reader. Saved generations use a
        // distinct server AbortController and stop only via the cancel route.
        stopLocalStream();
        clearError();
        await resumeStream();

        if (
          epochRef.current !== epoch ||
          document.visibilityState === "hidden"
        ) {
          return;
        }
        await delay(POLL_DELAY_MS);
      }
    })();

    recoveryRef.current = recovery;
    try {
      await recovery;
    } finally {
      if (recoveryRef.current === recovery) recoveryRef.current = null;
    }
  }, [
    chatId,
    clearError,
    enabled,
    onSettled,
    resumeStream,
    setMessages,
    stopLocalStream,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const recover = () => void reconcile().catch(() => undefined);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", recover);
    if (recoverOnMount) recover();

    return () => {
      epochRef.current += 1;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", recover);
    };
  }, [enabled, reconcile, recoverOnMount]);

  return reconcile;
}
