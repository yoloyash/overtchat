"use client";

import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { chatErrorMessage } from "@/lib/chat/message";
import type { InferenceActivity } from "@/lib/chat/inference-activity";
import {
  formatInteger,
  formatTps,
  readMessageStats,
  type StoredMessageStats,
} from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
import type { useSpeech } from "@/lib/useSpeech";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  streaming,
  status,
  inferenceActivity,
  error,
  configured,
  speech,
  showStats,
  storedStats,
  onRegenerate,
  onEdit,
  onRetry,
}: {
  messages: UIMessage[];
  streaming: boolean;
  status: ChatStatus;
  inferenceActivity: InferenceActivity | null;
  error: Error | undefined;
  configured: boolean;
  speech: ReturnType<typeof useSpeech>;
  showStats: boolean;
  storedStats: StoredMessageStats;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string, files: FileUIPart[]) => void;
  onRetry: () => void;
}) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain"
      >
        <div
          ref={contentRef}
          className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-10 pb-8"
        >
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              streaming={streaming && i === messages.length - 1}
              canAct={!streaming && configured}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
              speech={speech}
              showStats={showStats}
              stats={readMessageStats(m) ?? storedStats[m.id] ?? null}
            />
          ))}
          {error && <ChatErrorBubble error={error} onRetry={onRetry} />}
          {!error && streaming && inferenceActivity && (
            <InferenceActivityIndicator activity={inferenceActivity} />
          )}
          {!error &&
            !inferenceActivity &&
            status === "submitted" &&
            messages.at(-1)?.role === "user" && <PendingIndicator />}
        </div>
      </div>

      {!isAtBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="pointer-events-auto rounded-full bg-background/95 shadow-md backdrop-blur"
            onClick={() => void scrollToBottom()}
            aria-label="Scroll to bottom"
          >
            <ChevronDown />
          </Button>
        </div>
      )}
    </div>
  );
}

function InferenceActivityIndicator({
  activity,
}: {
  activity: InferenceActivity;
}) {
  const details: string[] = [];
  let label: string;

  if (activity.phase === "prompt") {
    const cachedTokens = activity.cachedTokens ?? 0;
    label =
      activity.progress === undefined
        ? "Processing prompt"
        : `Processing prompt ${Math.round(activity.progress * 100)}%`;
    if (activity.totalTokens !== undefined) {
      details.push(
        `${formatInteger(activity.completedTokens)} / ${formatInteger(activity.totalTokens)} ${cachedTokens > 0 ? "new" : "tokens"}`,
      );
    }
    if (cachedTokens > 0) {
      details.push(`${formatInteger(cachedTokens)} cached`);
    }
  } else {
    label = "Generating";
    details.push(`${formatInteger(activity.completedTokens)} tokens`);
  }

  if (activity.tokensPerSecond !== undefined) {
    details.push(formatTps(activity.tokensPerSecond));
  }

  const description = [label, ...details].join(" · ");
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs text-muted-foreground"
      role="status"
      aria-label={description}
      aria-live="polite"
    >
      <PendingDots />
      <span className="font-medium text-foreground/80">{label}</span>
      {details.length > 0 && (
        <span className="tabular-nums">{details.join(" · ")}</span>
      )}
    </div>
  );
}

function PendingIndicator() {
  return (
    <div
      className="flex items-center gap-1.5 py-2"
      role="status"
      aria-label="Assistant is responding"
    >
      <PendingDots />
    </div>
  );
}

function PendingDots() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      <span className={`size-1.5 rounded-full bg-muted-foreground/70 [animation-delay:-0.3s] ${motionClasses.pendingDot}`} />
      <span className={`size-1.5 rounded-full bg-muted-foreground/70 [animation-delay:-0.15s] ${motionClasses.pendingDot}`} />
      <span className={`size-1.5 rounded-full bg-muted-foreground/70 ${motionClasses.pendingDot}`} />
    </span>
  );
}

function ChatErrorBubble({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{chatErrorMessage(error)}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="shrink-0"
      >
        <RotateCcw /> Retry
      </Button>
    </div>
  );
}
