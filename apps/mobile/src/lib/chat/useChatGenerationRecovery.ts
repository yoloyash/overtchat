import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  ChatGenerationCoordinator,
  type ChatGenerationState,
} from "@overtchat/shared";
import type { UIMessage } from "ai";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { authFetch } from "@/lib/api";

export function useChatGenerationRecovery({
  baseURL,
  chatId,
  status,
  temporary = false,
  enabled,
  suspended = false,
  recoverOnMount,
  stopLocalStream,
  resumeStream,
  clearError,
  setMessages,
  onSettled,
}: {
  baseURL: string;
  chatId: string;
  status: string;
  temporary?: boolean;
  enabled: boolean;
  suspended?: boolean;
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
    [baseURL, chatId],
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
    () => {
      if (suspended) return;
      return generation.attach({
        temporary: () => latest.current.temporary,
        read: async (signal) => {
          const response = await authFetch(
            `${baseURL}/api/chat/${encodeURIComponent(chatId)}/stream/status`,
            { signal },
          );
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("Could not inspect generation");
          return (await response.json()) as ChatGenerationState;
        },
        cancel: async (signal) => {
          const response = await authFetch(
            `${baseURL}/api/chat/${encodeURIComponent(chatId)}/stream/cancel`,
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
        foreground: () => AppState.currentState === "active",
      });
    },
    [generation, baseURL, chatId, suspended],
  );

  useEffect(() => {
    if (!enabled || suspended) return;
    const recover = () => void generation.reconcile().catch(() => undefined);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") recover();
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) recover();
    });
    if (recoverOnMount) recover();
    return () => {
      appState.remove();
      network.remove();
    };
  }, [enabled, suspended, generation, recoverOnMount]);
  return generation;
}
