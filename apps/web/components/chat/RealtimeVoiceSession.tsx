"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { getErrorMessage } from "@/lib/errors";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Mic, MicOff, Square } from "lucide-react";
import type {
  ChatReasoningLevel,
  VoiceSessionGrant,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  OvertChatVoiceClient,
  type VoiceClientStatus,
} from "@/lib/voice/client";
import { apiUrl } from "@/lib/api-url";
import type { UIMessage } from "ai";
import { fetchChatMessagesPage } from "@/lib/queries/chats";

export interface RealtimeVoiceSessionHandle {
  sendMessage: (text: string) => void;
  end: () => Promise<void>;
}

interface Props {
  chatId: string;
  projectId: string | null;
  modelConfigId: string;
  modelLabel: string;
  webSearchEnabled: boolean;
  reasoningLevel: ChatReasoningLevel;
  onMessages: (messages: UIMessage[]) => void;
  onPersisted: () => void;
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow it in your browser and try again.";
  }
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return "Microphone access requires HTTPS for non-local addresses.";
  }
  return getErrorMessage(error, "The voice session could not start.");
}

function statusLabel(
  status: VoiceClientStatus,
): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "user-speaking":
      return "Listening to you";
    case "thinking":
      return "Thinking";
    case "assistant-speaking":
      return "Speaking";
    case "closed":
      return "Ended";
    default:
      return "Listening";
  }
}

export const RealtimeVoiceSession = forwardRef<
  RealtimeVoiceSessionHandle,
  Props
>(function RealtimeVoiceSession(
  {
    chatId,
    projectId,
    modelConfigId,
    modelLabel,
    webSearchEnabled,
    reasoningLevel,
    onMessages,
    onPersisted,
  },
  ref,
) {
  const clientRef = useRef<OvertChatVoiceClient | null>(null);
  const callbacksRef = useRef({ onMessages, onPersisted });
  useEffect(() => { callbacksRef.current = { onMessages, onPersisted }; }, [onMessages, onPersisted]);
  const endRef = useRef<() => Promise<void>>(async () => {});
  const [status, setStatus] = useState<VoiceClientStatus>("connecting");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnWarning, setTurnWarning] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    end: () => endRef.current(),
    sendMessage(text) {
      clientRef.current?.sendMessage(text);
    },
  }));

  // Freeze model/search/reasoning for this connection. The parent ends voice
  // before changing them, so the UI and signed ticket cannot silently diverge.
  useEffect(() => {
    let mounted = true;
    let grant: VoiceSessionGrant | null = null;
    const events = new AbortController();
    const release = async () => {
      if (!grant) return;
      const response = await fetch(apiUrl("/api/voice/session"), {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: grant.sessionId }), keepalive: true,
      });
      if (!response.ok) throw new Error("Could not end the voice session.");
    };
    const refresh = async () => {
      const page = await fetchChatMessagesPage(chatId);
      if (page && mounted) {
        callbacksRef.current.onMessages(page.messages);
        callbacksRef.current.onPersisted();
      }
    };
    endRef.current = async () => {
      await clientRef.current?.close();
      await release();
      // Ending voice must settle the shared generation before text can submit.
      const deadline = Date.now() + 15_000;
      while (true) {
        const response = await fetch(apiUrl(`/api/chat/${encodeURIComponent(chatId)}/stream/status`));
        if (response.status === 404) break;
        if (!response.ok) throw new Error("Could not finish the voice session. Try End again.");
        if (!(await response.json()).active) break;
        if (Date.now() >= deadline) throw new Error("The response is still stopping. Try End again.");
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      await refresh();
      events.abort();
    };
    async function start() {
      try {
        const response = await fetch(apiUrl("/api/voice/session"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, projectId, modelConfigId, webSearchEnabled, reasoningLevel,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        const body = await response.json();
        if (!response.ok || !body.token) throw new Error(body.error || "Could not start voice.");
        grant = body as VoiceSessionGrant;
        if (!mounted) { await release(); return; }
        // Subscribe before opening the microphone: no initial turn can race the
        // canonical message stream. The realtime transcript is audio-only.
        const eventResponse = await fetch(apiUrl("/api/voice/events"), {
          headers: { "X-OvertChat-Voice-Ticket": grant.token }, signal: events.signal,
        });
        if (!eventResponse.ok || !eventResponse.body) throw new Error("Could not connect voice history.");
        const reader = eventResponse.body.pipeThrough(new TextDecoderStream()).getReader();
        void (async () => {
          let pending = "";
          try {
            while (mounted) {
              const { value, done } = await reader.read();
              if (!mounted) break;
              if (done) throw new Error("The voice connection ended. End voice and reconnect.");
              pending += value;
              let boundary: number;
              while ((boundary = pending.indexOf("\n\n")) !== -1) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                if (!frame.startsWith("data: ")) continue;
                const event = JSON.parse(frame.slice(6));
                if (event.type === "message") {
                  callbacksRef.current.onMessages([event.message]);
                  if (event.message.role === "user") {
                    clientRef.current?.setActiveTurn(event.message.id);
                    callbacksRef.current.onPersisted();
                  }
                } else if (event.type === "settled") {
                  clientRef.current?.setActiveTurn(null);
                  await refresh();
                }
                else if (event.type === "error") setTurnWarning(event.message);
              }
            }
          } catch (reason) {
            if (!events.signal.aborted && mounted) {
              setError(friendlyError(reason));
              await clientRef.current?.close();
              await release().catch(() => {});
              await refresh().catch(() => {});
            }
          } finally { reader.releaseLock(); }
        })();
        const client = new OvertChatVoiceClient(grant, {
          onStatus: (next) => mounted && setStatus(next),
          onInputLevel: (level) => mounted && setInputLevel(level),
          onOutputLevel: (level) => mounted && setOutputLevel(level),
          onError: (nextError) => {
            if (mounted) setError(friendlyError(nextError));
            void release().catch(() => {});
          },
          onWarning: (message) => mounted && setTurnWarning(message),
        });
        clientRef.current = client;
        await client.connect();
      } catch (reason) {
        await clientRef.current?.close();
        await release().catch(() => {});
        events.abort();
        if (mounted) setError(friendlyError(reason));
      }
    }
    void start();
    return () => {
      mounted = false;
      events.abort();
      void clientRef.current?.close();
      clientRef.current = null;
      void release().catch(() => {});
    };
  }, [chatId, modelConfigId, projectId, webSearchEnabled, reasoningLevel]);

  const connected = status !== "connecting" && status !== "closed" && !error;
  const label = statusLabel(status);

  return (
    <div className="mb-3 overflow-hidden rounded-3xl border bg-background/95 shadow-sm">
      <div className="flex min-h-28 items-center gap-3 px-3 py-2.5 sm:px-4">
        <VoiceOrb
          status={status}
          inputLevel={inputLevel}
          outputLevel={outputLevel}
          muted={muted}
          error={Boolean(error)}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{error ?? label}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {error
              ? "End the session and try again"
              : `${modelLabel} · ${muted ? "Microphone muted" : "Realtime voice"}`}
          </p>
          {turnWarning && (
            <ErrorNotice className="mt-1" message={turnWarning} onDismiss={() => setTurnWarning(null)} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            disabled={!connected}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              clientRef.current?.setMuted(next);
            }}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? <MicOff /> : <Mic />}
          </Button>
          {connected && (status === "assistant-speaking" || status === "thinking") && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => clientRef.current?.interrupt()}
              aria-label="Stop assistant"
            >
              <Square className="size-3 fill-current" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

function VoiceOrb({
  status,
  inputLevel,
  outputLevel,
  muted,
  error,
}: {
  status: VoiceClientStatus;
  inputLevel: number;
  outputLevel: number;
  muted: boolean;
  error: boolean;
}) {
  const measuredLevel =
    status === "assistant-speaking"
      ? outputLevel
      : muted
        ? 0
        : Math.min(1, inputLevel * 7);
  const level = Math.max(
    measuredLevel,
    status === "user-speaking" || status === "assistant-speaking" ? 0.06 : 0,
  );
  const color = error
    ? "var(--destructive)"
    : status === "thinking"
      ? "var(--context-warning)"
      : "var(--primary)";
  const style = {
    "--voice-level": level.toFixed(3),
    "--voice-color": color,
  } as CSSProperties;
  const bars = [0.48, 0.76, 1, 0.82, 0.58, 0.88, 0.52];

  return (
    <div
      className={cn("voice-orb", "voice-orb--composer")}
      data-status={error ? "error" : status}
      data-muted={muted || undefined}
      style={style}
      aria-hidden="true"
    >
      <span className="voice-orb__ambient" />
      <span className="voice-orb__arc" />
      <span className="voice-orb__ring voice-orb__ring--outer" />
      <span className="voice-orb__ring voice-orb__ring--inner" />
      <span className="voice-orb__satellite" />
      <span className="voice-orb__core">
        <span className="voice-orb__surface" />
        <span className="voice-orb__spectrum">
          {bars.map((weight, index) => (
            <span
              key={index}
              style={{
                height: `${3 + Math.max(0.08, level) * weight * 18}px`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}
