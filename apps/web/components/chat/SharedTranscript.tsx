import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { collectOpenUIStates } from "@overtchat/shared";
import { MessageBubble } from "./MessageBubble";
import { Button } from "@/components/ui/button";

export function SharedTranscript({ messages }: { messages: UIMessage[] }) {
  const [visible, setVisible] = useState(50);
  const openuiStates = useMemo(() => collectOpenUIStates(messages), [messages]);
  return (
    <div className="space-y-8" data-shared-transcript="">
      {messages.slice(0, visible).map((message) => (
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
      {visible < messages.length && (
        <Button
          variant="outline"
          onClick={() => setVisible((count) => count + 50)}
        >
          Show more messages
        </Button>
      )}
    </div>
  );
}
