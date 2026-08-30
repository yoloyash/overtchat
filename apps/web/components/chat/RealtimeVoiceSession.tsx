"use client";

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
  ChatKind,
  VoiceHistoryItem,
  VoiceSessionGrant,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  OvertChatVoiceClient,
  type VoiceClientStatus,
  type VoiceToolActivityUpdate,
  type VoiceTranscriptUpdate,
} from "@/lib/voice/client";

export interface RealtimeVoiceSessionHandle {
  sendMessage: (text: string) => void;
}

interface PersistedVoiceChat {
  id: string;
  title: string | null;
  kind: ChatKind;
  projectId: string | null;
  updatedAt: number;
}

interface Props {
  chatId: string;
  projectId: string | null;
  modelConfigId: string;
  modelLabel: string;
  webSearchEnabled: boolean;
  onTranscript: (update: VoiceTranscriptUpdate) => void;
  onHistoryItems: (items: VoiceHistoryItem[]) => void;
  onPersisted: (chat: PersistedVoiceChat) => void;
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow it in your browser and try again.";
  }
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return "Microphone access requires HTTPS for non-local addresses.";
  }
  return error instanceof Error ? error.message : "The voice session could not start.";
}

function statusLabel(
  status: VoiceClientStatus,
  activity: VoiceToolActivityUpdate | null,
): string {
  if (activity?.status === "running") return activity.label;
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
    onTranscript,
    onHistoryItems,
    onPersisted,
  },
  ref,
) {
  const clientRef = useRef<OvertChatVoiceClient | null>(null);
  const callbacksRef = useRef({
    onTranscript,
    onHistoryItems,
    onPersisted,
  });
  useEffect(() => {
    callbacksRef.current = {
      onTranscript,
      onHistoryItems,
      onPersisted,
    };
  }, [onHistoryItems, onPersisted, onTranscript]);
  const persistQueueRef = useRef(Promise.resolve());
  const [status, setStatus] = useState<VoiceClientStatus>("connecting");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [activity, setActivity] = useState<VoiceToolActivityUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    sendMessage(text) {
      clientRef.current?.sendMessage(text);
    },
  }));

  useEffect(() => {
    let mounted = true;

    async function start() {
      try {
        const response = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            projectId,
            modelConfigId,
            webSearchEnabled,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const grant = (await response.json().catch(() => null)) as
          | (VoiceSessionGrant & { error?: string })
          | null;
        if (!response.ok || !grant?.token) {
          throw new Error(grant?.error || `Voice session failed (${response.status}).`);
        }
        if (!mounted) return;

        const client = new OvertChatVoiceClient(grant, {
          onStatus: (next) => mounted && setStatus(next),
          onTranscript: (update) => {
            if (mounted) callbacksRef.current.onTranscript(update);
          },
          onInputLevel: (level) => mounted && setInputLevel(level),
          onOutputLevel: (level) => mounted && setOutputLevel(level),
          onError: (nextError) => mounted && setError(friendlyError(nextError)),
          onToolActivity: (nextActivity) => {
            if (mounted) setActivity(nextActivity);
          },
          onHistoryItems: (items) => {
            callbacksRef.current.onHistoryItems(items);
            persistQueueRef.current = persistQueueRef.current.then(async () => {
              const syncResponse = await fetch("/api/voice/history", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${grant.token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ items }),
              });
              const body = (await syncResponse.json().catch(() => null)) as
                | { chat?: PersistedVoiceChat | null }
                | null;
              if (!syncResponse.ok) {
                throw new Error(`Voice history could not be saved (${syncResponse.status}).`);
              }
              if (body?.chat) callbacksRef.current.onPersisted(body.chat);
            }).catch((reason: unknown) => {
              if (mounted) setSaveWarning(friendlyError(reason));
            });
          },
        });
        clientRef.current = client;
        await client.connect();
      } catch (reason) {
        const client = clientRef.current;
        clientRef.current = null;
        if (client) await client.close();
        if (mounted) setError(friendlyError(reason));
      }
    }

    void start();
    return () => {
      mounted = false;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.close();
    };
  }, [chatId, modelConfigId, projectId, webSearchEnabled]);

  const connected = status !== "connecting" && status !== "closed" && !error;
  const label = statusLabel(status, activity);

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
              : activity?.status === "running" && activity.detail
                ? activity.detail
                : `${modelLabel} · ${muted ? "Microphone muted" : "Realtime voice"}`}
          </p>
          {saveWarning && (
            <p className="mt-1 text-xs text-destructive">{saveWarning}</p>
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            disabled={!connected || status !== "assistant-speaking"}
            onClick={() => clientRef.current?.interrupt()}
            aria-label="Stop assistant"
          >
            <Square className="size-3 fill-current" />
          </Button>
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
