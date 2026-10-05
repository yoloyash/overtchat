import type { FileUIPart } from "ai";

export interface QueuedChatMessage {
  id: string;
  text: string;
  files: FileUIPart[];
  body: Record<string, unknown>;
}

interface QueueSnapshot {
  messages: QueuedChatMessage[];
  paused: boolean;
  sendingId: string | null;
  editingId: string | null;
  error: string | null;
}

export interface ChatQueueTransport {
  /** False means the preceding server turn failed or was stopped. */
  prepare: (signal: AbortSignal, explicit: boolean) => Promise<boolean | void>;
  cancel: (signal: AbortSignal) => Promise<void>;
  send: (message: QueuedChatMessage) => Promise<void>;
}

type Operation = {
  phase: "preparing" | "sending" | "cancelling";
  controller: AbortController;
};

/** Pending drafts outlive views; operations belong exclusively to one mount. */
export class ChatMessageQueue {
  private state: QueueSnapshot = {
    messages: [],
    paused: false,
    sendingId: null,
    editingId: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private transport: ChatQueueTransport | null = null;
  private owner: object | null = null;
  private operation: Operation | null = null;
  private busy = true;
  private immediateId: string | null = null;

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<QueueSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private invalidateOperation() {
    const previous = this.operation;
    this.operation = null;
    previous?.controller.abort();
    this.update({ sendingId: null });
  }

  attach(transport: ChatQueueTransport) {
    this.invalidateOperation();
    const owner = {};
    this.owner = owner;
    this.transport = transport;
    this.busy = true; // The new owner must reconcile its own status.
    return () => {
      if (this.owner !== owner) return;
      this.owner = null;
      this.transport = null;
      this.invalidateOperation();
    };
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.drain();
  }

  enqueue(message: QueuedChatMessage) {
    if (!this.busy && !this.operation && !this.state.messages.length) {
      this.immediateId = message.id;
      this.update({ paused: false, error: null });
    }
    this.update({ messages: [...this.state.messages, message] });
    this.drain();
  }

  pause() {
    this.update({ paused: true });
    this.immediateId = null;
    // A newer Stop wins over every older async completion, including Send now.
    this.invalidateOperation();
  }

  clear() {
    this.pause();
    this.update({ messages: [], editingId: null, error: null });
  }

  remove(id: string) {
    if (id === this.state.sendingId) return;
    if (this.operation?.phase === "preparing") this.invalidateOperation();
    const messages = this.state.messages.filter((message) => message.id !== id);
    this.update({
      messages,
      error: messages.length ? this.state.error : null,
      editingId: this.state.editingId === id ? null : this.state.editingId,
    });
    this.drain();
  }

  edit(id: string | null) {
    if (id && id === this.state.sendingId) return;
    if (this.operation?.phase === "preparing") this.invalidateOperation();
    this.update({ editingId: id });
    this.drain();
  }

  save(id: string, text: string) {
    const message = this.state.messages.find((item) => item.id === id);
    if (!message || (!text.trim() && !message.files.length)) return;
    this.update({
      messages: this.state.messages.map((item) =>
        item.id === id ? { ...item, text: text.trim() } : item,
      ),
      editingId: null,
    });
    this.drain();
  }

  async sendNow(id: string) {
    const transport = this.transport;
    if (
      !transport ||
      this.operation?.phase === "cancelling" ||
      !this.state.messages.some((message) => message.id === id)
    )
      return;
    this.invalidateOperation();
    const operation: Operation = {
      phase: "cancelling",
      controller: new AbortController(),
    };
    this.operation = operation;
    this.update({ sendingId: id, editingId: null, error: null });
    try {
      await transport.cancel(operation.controller.signal);
      if (this.operation !== operation) return;
      const message = this.state.messages.find((item) => item.id === id);
      if (!message) return;
      this.update({
        messages: [
          message,
          ...this.state.messages.filter((item) => item.id !== id),
        ],
        paused: false,
      });
      this.immediateId = id;
      this.busy = false;
    } catch {
      if (this.operation === operation)
        this.update({
          paused: true,
          error:
            "Could not stop the response. Your queued message is still here; try Send now again.",
        });
    } finally {
      if (this.operation === operation) {
        this.operation = null;
        this.update({ sendingId: null });
        this.drain();
      }
    }
  }

  private drain() {
    const transport = this.transport;
    const message = this.state.messages[0];
    if (
      !transport ||
      !message ||
      this.busy ||
      this.operation ||
      this.state.paused ||
      this.state.editingId
    )
      return;
    const operation: Operation = {
      phase: "preparing",
      controller: new AbortController(),
    };
    this.operation = operation;
    this.update({ error: null });
    void (async () => {
      const ready = await transport.prepare(
        operation.controller.signal,
        this.immediateId === message.id,
      );
      if (this.operation !== operation) return;
      if (ready === false) {
        this.pause();
        return;
      }
      operation.phase = "sending";
      this.update({
        messages: this.state.messages.filter((item) => item.id !== message.id),
      });
      this.immediateId = null;
      await transport.send(message);
    })()
      .catch(() => {
        if (this.operation === operation)
          this.update({
            paused: true,
            error:
              "Could not send the queued message. Check your connection and try again.",
          });
      })
      .finally(() => {
        if (this.operation !== operation) return;
        this.operation = null;
        this.drain();
      });
  }
}

/** Owned by a client session/cache, never by a process-wide chat-ID map. */
class ChatQueueStore {
  private queues = new Map<
    string,
    { chatId: string; queue: ChatMessageQueue }
  >();

  get(scope: string, chatId: string) {
    return (
      this.queues.get(JSON.stringify([scope, chatId]))?.queue ??
      new ChatMessageQueue()
    );
  }

  retain(scope: string, chatId: string, queue: ChatMessageQueue) {
    const key = JSON.stringify([scope, chatId]);
    this.queues.set(key, { chatId, queue });
    return () => {
      if (
        this.queues.get(key)?.queue === queue &&
        !queue.getSnapshot().messages.length
      ) {
        this.queues.delete(key);
      }
    };
  }

  deleteChat(chatId: string) {
    for (const [key, entry] of this.queues) {
      if (entry.chatId !== chatId) continue;
      entry.queue.clear();
      this.queues.delete(key);
    }
  }

  clear() {
    for (const { queue } of this.queues.values()) queue.clear();
    this.queues.clear();
  }
}

const queueStores = new WeakMap<object, ChatQueueStore>();

export function getChatQueueStore(owner: object) {
  let store = queueStores.get(owner);
  if (!store) {
    store = new ChatQueueStore();
    queueStores.set(owner, store);
  }
  return store;
}
