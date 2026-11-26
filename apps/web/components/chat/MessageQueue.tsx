"use client";

import { useState } from "react";
import type { ChatMessageQueue, QueuedChatMessage } from "@overtchat/shared";
import { useTranslation } from "react-i18next";
import { ArrowUp, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface MessageQueueProps
  extends ReturnType<ChatMessageQueue["getSnapshot"]> {
  queue: ChatMessageQueue;
}

export function MessageQueue({
  queue,
  messages,
  paused,
  sendingId,
  editingId,
  error,
}: MessageQueueProps) {
  const { t } = useTranslation();
  if (!messages.length && !error) return null;
  return (
    <section
      aria-label={t("chat.queue.queuedMessages")}
      className="mb-2 max-h-64 overflow-y-auto rounded-2xl border bg-muted/30 p-2"
    >
      <p className="px-2 pb-1 text-xs text-muted-foreground" role="status">
        {paused ? t("chat.queue.pausedStatus") : t("chat.queue.queuedMessages")}
      </p>
      {error && (
        <p role="alert" className="px-2 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {messages.map((message) => (
        <div
          key={message.id}
          data-testid="queued-message"
          className="rounded-xl px-2 py-1"
        >
          {editingId === message.id ? (
            <QueueEditor message={message} queue={queue} />
          ) : (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="line-clamp-2 whitespace-pre-wrap break-words">
                  {message.text}
                </p>
                {message.files.map((file, index) => (
                  <p
                    key={index}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {file.filename || t("chat.queue.attachmentFallback")}
                  </p>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.queue.sendNow")}
                title={t("chat.queue.sendNowTitle")}
                disabled={sendingId !== null}
                onClick={() => void queue.sendNow(message.id)}
              >
                {sendingId === message.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowUp />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.queue.editMessage")}
                title={t("chat.queue.editMessage")}
                disabled={sendingId === message.id}
                onClick={() => queue.edit(message.id)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.queue.deleteMessage")}
                title={t("chat.queue.deleteMessage")}
                disabled={sendingId === message.id}
                onClick={() => queue.remove(message.id)}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function QueueEditor({
  message,
  queue,
}: {
  message: QueuedChatMessage;
  queue: ChatMessageQueue;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(message.text);
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={t("chat.queue.editMessageText")}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") queue.edit(null);
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            queue.save(message.id, text);
          }
        }}
      />
      {message.files.map((file, index) => (
        <p key={index} className="truncate text-xs text-muted-foreground">
          {file.filename || t("chat.queue.attachmentFallback")}
        </p>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!text.trim() && !message.files.length}
          onClick={() => queue.save(message.id, text)}
        >
          {t("chat.queue.saveMessage")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => queue.edit(null)}>
          {t("chat.queue.cancelEdit")}
        </Button>
      </div>
    </div>
  );
}
