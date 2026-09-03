import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import type { ChatGenerationState } from "@overtchat/shared";
import type { UIMessage } from "ai";
import { authFetch } from "@/lib/api";

const POLL_DELAY_MS = 1_500;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

/** React Native counterpart to the web foreground recovery protocol. */
export function useChatGenerationRecovery({
  baseURL,
  chatId,
  enabled,
  recoverOnMount,
  stopLocalStream,
  resumeStream,
  clearError,
  setMessages,
  onSettled,
}: {
  baseURL: string;
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
        const response = await authFetch(
          `${baseURL}/api/chat/${encodeURIComponent(chatId)}/stream/status`,
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

        // Abort only the device's stale fetch. The explicit cancel endpoint is
        // the sole operation allowed to stop the server-owned generation.
        stopLocalStream();
        clearError();
        await resumeStream();

        if (epochRef.current !== epoch || AppState.currentState !== "active") {
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
    baseURL,
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
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") recover();
    });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) recover();
    });
    if (recoverOnMount) recover();

    return () => {
      epochRef.current += 1;
      appStateSubscription.remove();
      networkSubscription.remove();
    };
  }, [enabled, reconcile, recoverOnMount]);

  return reconcile;
}
