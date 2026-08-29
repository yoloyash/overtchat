"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import {
  AlertTriangle,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
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
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
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
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string, files: FileUIPart[]) => void;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollCompleteRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(false);
  const errorOffset = messages.length;
  const count = error ? errorOffset + 1 : errorOffset;

  const getItemKey = useCallback(
    (index: number) => {
      if (index < messages.length) {
        return `message:${messages[index].id}`;
      }
      return "chat-error";
    },
    [messages],
  );

  // TanStack Virtual intentionally exposes imperative scroll/measure methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      if (error && index === errorOffset) return 64;
      return 220;
    },
    getItemKey,
    overscan: 5,
    gap: 24,
    paddingStart: 40,
    paddingEnd: 32,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    onChange(instance) {
      const atBottom = instance.isAtEnd(80);
      setIsAtBottom((current) =>
        current === atBottom ? current : atBottom,
      );
      const atTop = (instance.scrollOffset ?? 0) <= 80;
      setIsAtTop((current) => (current === atTop ? current : atTop));
      if (
        initialScrollCompleteRef.current &&
        hasOlderMessages &&
        atTop
      ) {
        onLoadOlderMessages();
      }
    },
  });

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToEnd();
      initialScrollCompleteRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
    // Initial positioning only. Subsequent appends are handled by
    // followOnAppend and dynamic measurement anchoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        data-chat-transcript-scroll=""
        className="h-full overflow-y-auto overscroll-contain"
      >
        <div
          className="relative mx-auto w-full max-w-3xl"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            let content;
            const message = messages[item.index];
            if (message) {
              const isLast = item.index === messages.length - 1;
              content = (
                <>
                  <MessageBubble
                    message={message}
                    streaming={streaming && isLast}
                    canAct={!streaming && configured}
                    onRegenerate={onRegenerate}
                    onEdit={onEdit}
                    speech={speech}
                    showStats={showStats}
                    stats={
                      readMessageStats(message) ??
                      storedStats[message.id] ??
                      null
                    }
                  />
                  {isLast && !error && streaming && inferenceActivity && (
                    <InferenceActivityIndicator activity={inferenceActivity} />
                  )}
                  {isLast &&
                    !error &&
                    !inferenceActivity &&
                    status === "submitted" &&
                    message.role === "user" && <PendingIndicator />}
                </>
              );
            } else if (error && item.index === errorOffset) {
              content = <ChatErrorBubble error={error} onRetry={onRetry} />;
            }

            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                data-transcript-item=""
                data-message-id={message?.id}
                className="absolute top-0 left-0 w-full px-4"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>

      {(loadingOlderMessages || (hasOlderMessages && isAtTop)) && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          {loadingOlderMessages ? (
            <span
              className="flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
              role="status"
            >
              <LoaderCircle className="size-3.5 animate-spin" />
              Loading earlier messages
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto rounded-full bg-background/95 shadow-sm backdrop-blur"
              onClick={onLoadOlderMessages}
            >
              Load earlier messages
            </Button>
          )}
        </div>
      )}

      {!isAtBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="pointer-events-auto rounded-full bg-background/95 shadow-md backdrop-blur"
            onClick={() => virtualizer.scrollToEnd({ behavior: "smooth" })}
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
