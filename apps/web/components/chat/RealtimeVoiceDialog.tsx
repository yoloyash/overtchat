"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  AudioLines,
  Check,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Square,
  X,
} from "lucide-react";
import type { VoiceSessionGrant, WebSearchResult } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { stripCitationMarkers } from "@/lib/citations";
import { cleanDomain, faviconUrl } from "@/lib/web-client";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import {
  OvertChatVoiceClient,
  type VoiceClientStatus,
  type VoiceToolActivityUpdate,
  type VoiceTranscriptUpdate,
} from "@/lib/voice/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelConfigId: string;
  modelLabel: string;
  webSearchEnabled: boolean;
}

type VoiceTimelineItem =
  | { kind: "transcript"; value: VoiceTranscriptUpdate }
  | { kind: "tool"; value: VoiceToolActivityUpdate };

function statusLabel(
  status: VoiceClientStatus,
  toolActivity: VoiceToolActivityUpdate | undefined,
) {
  if (toolActivity) return toolActivity.label;
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
  const [timeline, setTimeline] = useState<VoiceTimelineItem[]>([]);
  const [inputLevel, setInputLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          },
          onTranscript: (update) => {
            if (!active) return;
            const sanitized = {
              ...update,
              text: stripCitationMarkers(update.text),
            };
            setTimeline((current) => {
              const index = current.findIndex(
                (item) =>
                  item.kind === "transcript" &&
                  item.value.id === sanitized.id &&
                  item.value.role === sanitized.role,
              );
              const item: VoiceTimelineItem = {
                kind: "transcript",
                value: sanitized,
              };
              if (index === -1) return [...current, item];
              const next = [...current];
              next[index] = item;
              return next;
            });
          },
          onInputLevel: (level) => active && setInputLevel(level),
          onError: (nextError) => {
            if (!active) return;
            setError(friendlyError(nextError));
          },
          onToolActivity: (activity) => {
            if (!active) return;
            setTimeline((current) => {
              const index = current.findIndex(
                (item) =>
                  item.kind === "tool" && item.value.id === activity.id,
              );
              const item: VoiceTimelineItem = { kind: "tool", value: activity };
              if (index === -1) return [...current, item];
              const next = [...current];
              next[index] = item;
              return next;
            });
          },
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
  }, [timeline]);

  const runningTool = timeline.findLast(
    (item) => item.kind === "tool" && item.value.status === "running",
  );
  const displayStatus = statusLabel(
    status,
    runningTool?.kind === "tool" ? runningTool.value : undefined,
  );
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
                {error ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {error}
                  </div>
                ) : timeline.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {status === "connecting"
                      ? "Preparing your microphone and voice models…"
                      : "Start speaking when you’re ready."}
                  </p>
                ) : (
                  timeline.map((item) =>
                    item.kind === "tool" ? (
                      <VoiceToolCard
                        key={`tool-${item.value.id}`}
                        activity={item.value}
                      />
                    ) : (
                      <div
                        key={`${item.value.role}-${item.value.id}`}
                        className={cn(
                          "max-w-[88%]",
                          item.value.role === "user"
                            ? "ml-auto text-right"
                            : "mr-auto",
                        )}
                      >
                        <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          {item.value.role === "user" ? "You" : "OvertChat"}
                        </div>
                        <p
                          className={cn(
                            "text-balance text-base leading-relaxed md:text-lg",
                            item.value.partial && "text-foreground/70",
                          )}
                        >
                          {item.value.text}
                        </p>
                      </div>
                    ),
                  )
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

function VoiceToolCard({ activity }: { activity: VoiceToolActivityUpdate }) {
  return (
    <div className="mr-auto w-full max-w-xl rounded-2xl border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {activity.status === "running" ? (
          <Loader2 className={`size-3.5 ${motionClasses.spinner}`} />
        ) : (
          <Check
            className={cn(
              "size-3.5",
              activity.status === "failed" && "text-destructive",
            )}
          />
        )}
        <span>{activity.label}</span>
      </div>
      {activity.detail && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {activity.detail}
        </p>
      )}
      {activity.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {activity.sources.map((source: WebSearchResult) => {
            const domain = cleanDomain(source.link);
            return (
              <a
                key={source.link}
                href={source.link}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1.5 text-xs text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={faviconUrl(domain)}
                  alt=""
                  loading="lazy"
                  className="size-3.5 rounded-full"
                />
                <span className="max-w-44 truncate">
                  {source.title || domain}
                </span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
