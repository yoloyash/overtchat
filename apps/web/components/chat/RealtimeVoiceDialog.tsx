"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Square,
  X,
} from "lucide-react";
import type { VoiceSessionGrant } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import {
  OvertChatVoiceClient,
  type VoiceClientStatus,
  type VoiceTranscriptUpdate,
} from "@/lib/voice/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelConfigId: string;
  modelLabel: string;
  webSearchEnabled: boolean;
}

function statusLabel(status: VoiceClientStatus, toolActivity: string | null) {
  if (toolActivity) return toolActivity;
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

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow microphone access in your browser and try again.";
  }
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return "Microphone access requires HTTPS for non-local addresses.";
  }
  return error instanceof Error ? error.message : "The voice session could not start.";
}

export function RealtimeVoiceDialog({
  open,
  onOpenChange,
  modelConfigId,
  modelLabel,
  webSearchEnabled,
}: Props) {
  const clientRef = useRef<OvertChatVoiceClient | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<VoiceClientStatus>("connecting");
  const [transcripts, setTranscripts] = useState<VoiceTranscriptUpdate[]>([]);
  const [inputLevel, setInputLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;

    async function start() {
      try {
        const response = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelConfigId,
            webSearchEnabled,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | (VoiceSessionGrant & { error?: string })
          | null;
        if (!response.ok || !body?.token) {
          throw new Error(body?.error || `Voice session failed (${response.status}).`);
        }
        if (!active) return;
        const client = new OvertChatVoiceClient(body, {
          onStatus: (next) => {
            if (!active) return;
            setStatus(next);
            if (next === "user-speaking") setNotice(null);
          },
          onTranscript: (update) => {
            if (!active) return;
            setNotice(null);
            setTranscripts((current) => {
              const index = current.findIndex(
                (entry) => entry.id === update.id && entry.role === update.role,
              );
              if (index === -1) return [...current, update];
              const next = [...current];
              next[index] = update;
              return next;
            });
          },
          onInputLevel: (level) => active && setInputLevel(level),
          onError: (nextError) => {
            if (!active) return;
            setError(friendlyError(nextError));
          },
          onRecoverableError: (nextError) => {
            if (!active) return;
            const message = friendlyError(nextError);
            setNotice(
              `${message.replace(/[.!?]?$/u, ".")} The conversation is still connected.`,
            );
          },
          onToolActivity: (activity) => active && setToolActivity(activity),
        });
        clientRef.current = client;
        await client.connect();
      } catch (nextError) {
        const client = clientRef.current;
        clientRef.current = null;
        if (client) await client.close();
        if (active) setError(friendlyError(nextError));
      }
    }

    void start();
    return () => {
      active = false;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.close();
    };
  }, [modelConfigId, open, webSearchEnabled]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [transcripts]);

  const displayStatus = statusLabel(status, toolActivity);
  const orbScale = useMemo(
    () => 1 + Math.min(0.2, inputLevel * 3.5),
    [inputLevel],
  );
  const active = status !== "connecting" && status !== "closed" && !error;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-background/85 backdrop-blur-xl",
            motionClasses.overlay,
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background text-foreground outline-none md:inset-4 md:rounded-3xl md:border md:shadow-2xl",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="sr-only">Realtime voice conversation</Dialog.Title>
          <header className="flex shrink-0 items-center justify-between gap-4 px-4 py-4 md:px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AudioLines className="size-4" />
                Voice
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {modelLabel}
                {webSearchEnabled ? " · Web search available" : ""}
              </p>
            </div>
            <Dialog.Close
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Close voice conversation"
                />
              }
            >
              <X />
            </Dialog.Close>
          </header>

          <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 pb-4 md:px-8">
            <div className="flex shrink-0 flex-col items-center pt-[clamp(1rem,6vh,4rem)] pb-6 text-center">
              <div className="relative flex size-40 items-center justify-center md:size-52">
                <div
                  className={cn(
                    "absolute inset-5 rounded-full bg-[radial-gradient(circle_at_35%_30%,color-mix(in_oklab,var(--primary)_70%,white),var(--primary)_42%,color-mix(in_oklab,var(--primary)_18%,transparent))] opacity-90 blur-[1px] transition-transform duration-100",
                    status === "assistant-speaking" && "animate-pulse",
                    error && "grayscale",
                  )}
                  style={{ transform: `scale(${orbScale})` }}
                />
                <div className="absolute inset-0 rounded-full border border-primary/15 bg-primary/5 blur-xl" />
                {status === "connecting" ? (
                  <Loader2 className={`relative size-8 text-primary ${motionClasses.spinner}`} />
                ) : (
                  <AudioLines className="relative size-9 text-primary-foreground drop-shadow" />
                )}
              </div>
              <p className="mt-3 text-base font-medium">{error ? "Connection problem" : displayStatus}</p>
              {!error && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {muted ? "Microphone muted" : "You can interrupt at any time"}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black)]">
              <div className="mx-auto flex max-w-2xl flex-col gap-5 px-1 pt-6 pb-8">
                {notice && !error && (
                  <div className="rounded-2xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                    {notice}
                  </div>
                )}
                {error ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {error}
                  </div>
                ) : transcripts.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {status === "connecting"
                      ? "Preparing your microphone and voice models…"
                      : "Start speaking when you’re ready."}
                  </p>
                ) : (
                  transcripts.map((entry) => (
                    <div
                      key={`${entry.role}-${entry.id}`}
                      className={cn(
                        "max-w-[88%]",
                        entry.role === "user" ? "ml-auto text-right" : "mr-auto",
                      )}
                    >
                      <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        {entry.role === "user" ? "You" : "OvertChat"}
                      </div>
                      <p
                        className={cn(
                          "text-balance text-base leading-relaxed md:text-lg",
                          entry.partial && "text-foreground/70",
                        )}
                      >
                        {entry.text}
                      </p>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          </main>

          <footer className="shrink-0 border-t bg-background/90 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:px-6">
            <div className="mx-auto flex max-w-md items-center justify-center gap-4">
              <Button
                type="button"
                variant={muted ? "secondary" : "outline"}
                size="icon-lg"
                className="rounded-full"
                disabled={!active}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  clientRef.current?.setMuted(next);
                }}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={muted}
              >
                {muted ? <MicOff /> : <Mic />}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="icon-lg"
                className="size-14 rounded-full"
                onClick={() => onOpenChange(false)}
                aria-label="End voice conversation"
              >
                <PhoneOff className="size-5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className="rounded-full"
                disabled={!active || status !== "assistant-speaking"}
                onClick={() => clientRef.current?.interrupt()}
                aria-label="Stop assistant"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            </div>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
