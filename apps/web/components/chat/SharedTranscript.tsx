import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { collectOpenUIStates, type OpenUIFormState } from "@overtchat/shared";
import { MessageBubble } from "./MessageBubble";
import { Button } from "@/components/ui/button";

export function SharedTranscript({
  messages,
  formStates,
  onLoadMore,
  hasMore,
  loadingMore,
}: {
  messages: UIMessage[];
  formStates?: Array<[string, OpenUIFormState]>;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const [visible, setVisible] = useState(50);
  const openuiStates = useMemo(
    () => new Map([...collectOpenUIStates(messages), ...(formStates ?? [])]),
    [messages, formStates],
  );
  return (
    <div className="space-y-8" data-shared-transcript="">
      {(onLoadMore ? messages : messages.slice(0, visible)).map((message) => (
        <article
          key={message.id}
          aria-label={
            message.role === "user" ? "User message" : "Assistant message"
          }
        >
          <MessageBubble
            message={message}
            streaming={false}
            canAct={false}
            readOnly
            showStats={false}
            stats={null}
            openuiStates={openuiStates}
          />
        </article>
      ))}
      {(onLoadMore ? hasMore : visible < messages.length) && (
        <Button
          variant="outline"
          disabled={loadingMore}
          onClick={onLoadMore ?? (() => setVisible((count) => count + 50))}
        >
          {loadingMore ? "Loading messages…" : "Show more messages"}
        </Button>
      )}
    </div>
  );
}
