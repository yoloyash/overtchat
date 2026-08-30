"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Search,
  Square,
  X,
} from "lucide-react";
import type { VoiceSessionGrant, WebSearchResult } from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { stripCitationMarkers } from "@/lib/citations";
import { cleanDomain } from "@/lib/web-client";
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
  const [outputLevel, setOutputLevel] = useState(0);
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
          onOutputLevel: (level) => active && setOutputLevel(level),
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
            "fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-15%,color-mix(in_oklab,var(--primary)_9%,transparent),transparent_42%),var(--background)] text-foreground outline-none md:inset-4 md:rounded-3xl md:border md:shadow-2xl",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="sr-only">Realtime voice conversation</Dialog.Title>
          <header className="flex shrink-0 items-center justify-between gap-4 px-5 pt-5 md:px-7 md:pt-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex size-2" aria-hidden="true">
                {active && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-30 motion-reduce:animate-none" />
                )}
                <span
                  className={cn(
                    "relative inline-flex size-2 rounded-full",
                    active ? "bg-primary" : "bg-muted-foreground/50",
                  )}
                />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">Voice session</div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span className="truncate">{modelLabel}</span>
                  {webSearchEnabled && (
                    <>
                      <span aria-hidden="true">·</span>
                      <Search className="size-3" />
                    </>
                  )}
                </p>
              </div>
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

          <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-5 md:px-8">
            <div className="flex shrink-0 flex-col items-center pt-[clamp(0.5rem,4vh,2.75rem)] pb-[clamp(1.25rem,3vh,2rem)] text-center">
              <VoiceOrb
                status={status}
                inputLevel={inputLevel}
                outputLevel={outputLevel}
                muted={muted}
                error={Boolean(error)}
              />
              <p className="mt-5 font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {error ? "Connection problem" : displayStatus}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground/70">
                {error
                  ? "The session is no longer available"
                  : muted
                    ? "Microphone muted"
                    : status === "assistant-speaking"
                      ? "Interrupt whenever you want"
                      : "Listening stays on until you end the session"}
              </p>
            </div>

            <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%-1rem),transparent)]">
              <div className="flex flex-col gap-4 px-1 pt-5 pb-8">
                {error ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {error}
                  </div>
                ) : timeline.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground/60">
                    {status === "connecting"
                      ? "Preparing audio…"
                      : "Your conversation will appear here"}
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
                          "max-w-[86%]",
                          item.value.role === "user"
                            ? "ml-auto text-right"
                            : "mr-auto",
                        )}
                      >
                        <div className="mb-1 text-[11px] font-medium text-muted-foreground/70">
                          {item.value.role === "user" ? "You" : "OvertChat"}
                        </div>
                        <p
                          className={cn(
                            "text-pretty text-[15px] leading-6 md:text-base",
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

          <footer className="shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pt-4">
            <div className="mx-auto flex w-fit items-center justify-center gap-1.5 rounded-full border bg-background/80 p-1.5 shadow-[0_12px_40px_color-mix(in_oklab,var(--foreground)_10%,transparent)] backdrop-blur-xl">
              <Button
                type="button"
                variant={muted ? "secondary" : "outline"}
                size="icon-lg"
                className="size-10 rounded-full border-transparent bg-transparent hover:bg-muted max-md:size-11"
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
                className="mx-1 size-11 rounded-full bg-destructive text-white shadow-sm hover:bg-destructive/90 max-md:size-12"
                onClick={() => onOpenChange(false)}
                aria-label="End voice conversation"
              >
                <PhoneOff className="size-5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className="size-10 rounded-full border-transparent bg-transparent hover:bg-muted max-md:size-11"
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
      className="voice-orb"
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
                height: `${5 + Math.max(0.08, level) * weight * 38}px`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

function VoiceToolCard({ activity }: { activity: VoiceToolActivityUpdate }) {
  return (
    <div className="mr-auto max-w-[88%] border-l border-border pl-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        {activity.status === "running" ? (
          <Loader2 className={`size-3.5 ${motionClasses.spinner}`} />
        ) : (
          <Search
            className={cn(
              "size-3.5 shrink-0",
              activity.status === "failed" && "text-destructive",
            )}
          />
        )}
        <span className="shrink-0 font-medium text-foreground/80">
          {activity.label}
        </span>
        {activity.detail && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{activity.detail}</span>
          </>
        )}
      </div>
      {activity.sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 pl-5">
          {activity.sources.map((source: WebSearchResult, index) => {
            const domain = cleanDomain(source.link);
            return (
              <a
                key={source.link}
                href={source.link}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
                className="max-w-44 truncate underline decoration-border underline-offset-2 motion-colors hover:text-foreground"
              >
                {index + 1}. {domain}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
