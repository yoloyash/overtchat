import { randomUUID } from "node:crypto";

type MessageEvent = { type: string; [key: string]: unknown };

/** Pi and OMP stream whole messages without a persistent entry ID. Track the
 * message lifecycle, not the last assistant row in the conversation. */
export class PiAssistantMessages {
  private active: { id: string; timestamp: unknown } | null = null;

  clear(): void {
    this.active = null;
  }

  annotate<T extends MessageEvent>(event: T): T {
    if (event.type === "process_exit") this.clear();
    if (
      !["message_start", "message_update", "message_end"].includes(event.type)
    ) {
      return event;
    }
    const message = event.message;
    if (
      !message ||
      typeof message !== "object" ||
      Reflect.get(message, "role") !== "assistant"
    ) {
      return event;
    }
    if (event.type === "message_start" || !this.active) {
      const nativeId = Reflect.get(message, "id");
      this.active = {
        id:
          typeof nativeId === "string" && nativeId
            ? nativeId
            : `assistant:${randomUUID()}`,
        timestamp: Reflect.get(message, "timestamp"),
      };
    }
    this.active.timestamp = Reflect.get(message, "timestamp");
    const annotated = { ...event, message: { ...message, id: this.active.id } };
    if (event.type === "message_end") this.clear();
    return annotated;
  }

  /** A history refresh may supply a native entry ID for the still-streaming
   * message. Keep its live identity until completion so the next delta updates
   * that row. Completed history retains the provider's durable IDs. */
  reconcileHistory(messages: unknown[]): unknown[] {
    const active = this.active;
    if (!active || typeof active.timestamp !== "number") return messages;
    const index = messages.findLastIndex(
      (message) =>
        message &&
        typeof message === "object" &&
        Reflect.get(message, "role") === "assistant" &&
        Reflect.get(message, "timestamp") === active.timestamp,
    );
    if (index < 0) return messages;
    return messages.map((message, i) =>
      i === index ? { ...(message as object), id: active.id } : message,
    );
  }
}
