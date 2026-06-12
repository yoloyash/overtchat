"use client";

import { useEffect, useRef } from "react";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatErrorMessage } from "@/lib/chat/message";
import { readMessageStats, type StoredMessageStats } from "@/lib/chat/stats";
import type { useSpeech } from "@/lib/useSpeech";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  messages,
  streaming,
  status,
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
  error: Error | undefined;
  configured: boolean;
  speech: ReturnType<typeof useSpeech>;
  showStats: boolean;
  storedStats: StoredMessageStats;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, text: string, files: FileUIPart[]) => void;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-10 pb-8">
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
        {!error &&
          status === "submitted" &&
          messages.at(-1)?.role === "user" && <PendingIndicator />}
      </div>
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
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
    </div>
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
