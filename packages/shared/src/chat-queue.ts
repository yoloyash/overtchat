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
  prepare: (signal: AbortSignal, explicit: boolean) => Promise<void>;
  cancel: (signal: AbortSignal) => Promise<void>;
  send: (message: QueuedChatMessage) => Promise<void>;
}

/** Session-local pending drafts. Only a mounted client may dispatch them. */
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
  private lifecycle: AbortController | null = null;
  private busy = true;
  private running: Promise<void> | null = null;
  private interrupting = false;
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

  attach(transport: ChatQueueTransport) {
    this.transport = transport;
    const lifecycle = new AbortController();
    this.lifecycle = lifecycle;
    return () => {
      lifecycle.abort();
      if (this.lifecycle === lifecycle) this.transport = null;
    };
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.drain();
  }

  enqueue(message: QueuedChatMessage) {
    if (!this.busy && !this.running && !this.state.messages.length) {
      this.immediateId = message.id;
      this.update({ paused: false, error: null });
    }
    this.update({ messages: [...this.state.messages, message] });
    this.drain();
  }

  pause() {
    this.update({ paused: true });
  }

  remove(id: string) {
    if (id === this.state.sendingId) return;
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
    const signal = this.lifecycle?.signal;
    if (
      !transport ||
      !signal ||
      this.interrupting ||
      this.state.sendingId ||
      !this.state.messages.some((message) => message.id === id)
    )
      return;
    this.interrupting = true;
    this.update({ sendingId: id, editingId: null, error: null });
    try {
      await transport.cancel(signal);
      await this.running;
      if (signal.aborted) throw new Error("Queue detached");
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
      if (!signal.aborted)
        this.update({
          paused: true,
          error:
            "Could not stop the response. Your queued message is still here; try Send now again.",
        });
    } finally {
      this.interrupting = false;
      this.update({ sendingId: null });
      this.drain();
    }
  }

  private drain() {
    const transport = this.transport;
    const signal = this.lifecycle?.signal;
    const message = this.state.messages[0];
    if (
      !transport ||
      !signal ||
      signal.aborted ||
      !message ||
      this.busy ||
      this.running ||
      this.interrupting ||
      this.state.paused ||
      this.state.editingId
    )
      return;
    this.update({ sendingId: message.id, error: null });
    const run = (async () => {
      await transport.prepare(signal, this.immediateId === message.id);
      if (signal.aborted) throw new Error("Queue detached");
      if (this.state.paused) return;
      this.update({
        messages: this.state.messages.filter((item) => item.id !== message.id),
        sendingId: null,
      });
      this.immediateId = null;
      await transport.send(message);
    })()
      .catch(() => {
        if (!signal.aborted)
          this.update({
            paused: true,
            error:
              "Could not send the queued message. Check your connection and try again.",
          });
      })
      .finally(() => {
        this.running = null;
        if (!this.interrupting) this.update({ sendingId: null });
        this.drain();
      });
    this.running = run;
  }
}
