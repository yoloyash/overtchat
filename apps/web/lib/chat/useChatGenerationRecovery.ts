"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  ChatGenerationCoordinator,
  type ChatGenerationState,
} from "@overtchat/shared";
import type { UIMessage } from "ai";
import { apiUrl } from "@/lib/api-url";

export function useChatGenerationRecovery({
  chatId,
  status,
  temporary = false,
  enabled,
  recoverOnMount,
  stopLocalStream,
  resumeStream,
  clearError,
  setMessages,
  onSettled,
}: {
  chatId: string;
  status: string;
  temporary?: boolean;
  enabled: boolean;
  recoverOnMount: boolean;
  stopLocalStream: () => void | Promise<void>;
  resumeStream: () => Promise<void>;
  clearError: () => void;
  setMessages: (
    messages: UIMessage[] | ((current: UIMessage[]) => UIMessage[]),
  ) => void;
  onSettled: () => void;
}) {
  const latest = useRef({
    temporary,
    stopLocalStream,
    resumeStream,
    clearError,
    setMessages,
    onSettled,
  });
  const generation = useMemo(
    () => new ChatGenerationCoordinator("ready"),
    [chatId],
  );

  useLayoutEffect(() => {
    latest.current = {
      temporary,
      stopLocalStream,
      resumeStream,
      clearError,
      setMessages,
      onSettled,
    };
    generation.observeStatus(status);
  });
  useEffect(
    () =>
      generation.attach({
        temporary: () => latest.current.temporary,
        read: async (signal) => {
          const response = await fetch(
            apiUrl(`/api/chat/${encodeURIComponent(chatId)}/stream/status`),
            { signal, cache: "no-store" },
          );
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("Could not inspect generation");
          return (await response.json()) as ChatGenerationState;
        },
        cancel: async (signal) => {
          const response = await fetch(
            apiUrl(`/api/chat/${encodeURIComponent(chatId)}/stream/cancel`),
            { method: "POST", signal },
          );
          if (!response.ok) throw new Error("Could not cancel generation");
        },
        stopReader: () => latest.current.stopLocalStream(),
        resumeReader: () => {
          latest.current.clearError();
          return latest.current.resumeStream();
        },
        apply: (state) => {
          const message = state.responseMessage;
          if (message)
            latest.current.setMessages((current) =>
              current.some((item) => item.id === message.id)
                ? current.map((item) =>
                    item.id === message.id ? message : item,
                  )
                : [...current, message],
            );
          latest.current.clearError();
          latest.current.onSettled();
        },
        foreground: () => document.visibilityState !== "hidden",
      }),
    [generation, chatId],
  );

  useEffect(() => {
    if (!enabled) return;
    const recover = () => void generation.reconcile().catch(() => undefined);
    const visibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", recover);
    if (recoverOnMount) recover();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", recover);
    };
  }, [enabled, generation, recoverOnMount]);
  return generation;
}
