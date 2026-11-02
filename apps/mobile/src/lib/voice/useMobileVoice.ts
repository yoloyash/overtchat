import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import type { UIMessage } from "ai";
import { OvertChatVoiceClient } from "@overtchat/voice-client";
import { authFetch, getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";
import { NativeVoiceAudio, nativeVoiceAvailable, requestVoicePermission, waitForVoiceForeground } from "./audio";
import { MobileVoiceSession, type VoiceOptions, type VoiceState } from "./session";

let previousCleanup: Promise<void> = Promise.resolve();

export interface MobileVoiceController extends VoiceState {
  available: boolean;
  busy: boolean;
  start: (config: VoiceOptions) => Promise<void>;
  end: () => Promise<boolean>;
  toggleMute: () => void;
  interrupt: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  dismissError: () => void;
  dismissWarning: () => void;
}

export function useMobileVoice(options: {
  chatId: string;
  onMessage: (message: UIMessage) => void;
  onRefresh: (messages: UIMessage[]) => void;
  onPersisted: () => void;
}): MobileVoiceController {
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<MobileVoiceSession | null>(null);
  const focused = useRef(false);
  const permissionAttempt = useRef(0);
  const preparingPermission = useRef<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [state, setState] = useState<VoiceState>({ status: "idle", muted: false, error: null, warning: null, inputLevel: 0, outputLevel: 0, pendingText: null, cleanupPending: false });

  useEffect(() => {
    const base = getApiBase();
    const auth = getAuthClient();
    const request = async (path: string, init: RequestInit = {}) => {
      if (base !== getApiBase() || auth !== getAuthClient()) throw new Error("Server changed");
      const abort = new AbortController();
      const forwardAbort = () => abort.abort();
      init.signal?.addEventListener("abort", forwardAbort, { once: true });
      if (init.signal?.aborted) abort.abort();
      // Bound the request handshake. The voice event body is a long-lived stream.
      const timeout = setTimeout(() => abort.abort(), 15_000);
      try {
        return await authFetch(`${base}${path}`, { ...init, signal: abort.signal } as Parameters<typeof authFetch>[1]) as unknown as Response;
      } finally {
        clearTimeout(timeout);
        // Keep the parent abort connected for the event reader's lifetime.
        if (path !== "/api/voice/events") init.signal?.removeEventListener("abort", forwardAbort);
      }
    };
    const current = new MobileVoiceSession({
      request,
      createClient: (grant, callbacks) => new OvertChatVoiceClient(grant, callbacks, {
        audio: new NativeVoiceAudio(callbacks),
        websocketUrl: path => `${base.replace(/^http/, "ws")}${path}`,
        fetch: request,
        createWebSocket: async ({ url, apiKey }) => new WebSocket(url, ["realtime", `openai-insecure-api-key.${apiKey}`]) as unknown as globalThis.WebSocket,
      }),
      onMessage: message => latest.current.onMessage(message),
      onRefresh: messages => latest.current.onRefresh(messages),
      onPersisted: () => latest.current.onPersisted(),
    });
    controller.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    setState(current.getSnapshot());
    const appState = AppState.addEventListener("change", next => {
      // Android's permission activity pauses this activity. No call exists yet;
      // let the permission result settle before enforcing foreground startup.
      if (next === "background" && (Platform.OS !== "android" || preparingPermission.current === null)) {
        permissionAttempt.current++;
        setPreparing(false);
      }
      if (next !== "active") void current.end().catch(() => {});
    });
    return () => {
      permissionAttempt.current++;
      unsubscribe();
      appState.remove();
      previousCleanup = current.end().catch(() => {});
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [options.chatId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      permissionAttempt.current++;
      setPreparing(false);
      void controller.current?.end().catch(() => {});
    };
  }, []));

  const start = async (config: VoiceOptions) => {
    if (preparing || !focused.current || controller.current?.getSnapshot().status !== "idle") return;
    const attempt = ++permissionAttempt.current;
    const current = controller.current;
    setPreparing(true);
    setPermissionError(null);
    try {
      await previousCleanup;
      if (attempt !== permissionAttempt.current) return;
      preparingPermission.current = attempt;
      const requested = await requestVoicePermission();
      await waitForVoiceForeground(requested);
      if (preparingPermission.current === attempt) preparingPermission.current = null;
      if (attempt === permissionAttempt.current && current === controller.current && focused.current && AppState.currentState === "active") {
        await current?.start(config);
      }
    } catch (error) {
      if (attempt === permissionAttempt.current) setPermissionError((error as Error).message);
    } finally {
      if (preparingPermission.current === attempt) preparingPermission.current = null;
      if (attempt === permissionAttempt.current) setPreparing(false);
    }
  };
  const status = preparing && state.status === "idle" ? ("connecting" as const) : state.status;
  return {
    ...state,
    status,
    error: permissionError ?? state.error,
    available: nativeVoiceAvailable,
    busy: preparing || state.status !== "idle",
    start,
    end: async (): Promise<boolean> => {
      permissionAttempt.current++;
      setPreparing(false);
      if (!controller.current) return true;
      try {
        await controller.current.end();
        return controller.current.getSnapshot().status === "idle";
      } catch {
        return false;
      }
    },
    toggleMute: () => controller.current?.toggleMute(),
    interrupt: () => controller.current?.interrupt(),
    sendMessage: (text: string) => controller.current?.sendMessage(text) ?? Promise.resolve(false),
    dismissWarning: () => controller.current?.dismissWarning(),
    dismissError: () => { setPermissionError(null); controller.current?.dismissError(); },
  };
}
