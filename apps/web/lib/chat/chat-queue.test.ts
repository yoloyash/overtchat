import { describe, expect, it, vi } from "vitest";
import {
  ChatMessageQueue,
  getChatQueueStore,
  type QueuedChatMessage,
} from "@overtchat/shared";

const message = (id: string): QueuedChatMessage => ({
  id,
  text: id,
  files: [
    {
      type: "file",
      url: "/upload/file",
      mediaType: "text/plain",
      filename: "notes.txt",
    },
  ],
  body: { modelConfigId: "model", forceSearch: true },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("chat queue", () => {
  it("holds FIFO messages while busy, preserves payloads, and edits without losing another draft", async () => {
    const queue = new ChatMessageQueue();
    const send = vi.fn().mockResolvedValue(undefined);
    queue.attach({ prepare: async () => {}, cancel: async () => {}, send });
    queue.enqueue(message("one"));
    queue.enqueue(message("two"));
    queue.enqueue(message("delete"));
    queue.remove("delete");
    queue.edit("one");
    queue.setBusy(false);
    await tick();
    expect(send).not.toHaveBeenCalled();
    queue.save("one", "edited");
    await tick();
    await tick();
    expect(send.mock.calls.map(([item]) => item.text)).toEqual([
      "edited",
      "two",
    ]);
    expect(send.mock.calls[0][0]).toMatchObject({
      files: message("one").files,
      body: message("one").body,
    });
  });

  it("send now cancels and waits for the active turn before promoting the selected message", async () => {
    const queue = new ChatMessageQueue();
    const active = deferred();
    const cancellation = deferred();
    const events: string[] = [];
    queue.attach({
      prepare: async () => {},
      cancel: async () => {
        events.push("cancel");
        await cancellation.promise;
        active.resolve();
      },
      send: async (item) => {
        events.push(item.id);
        if (item.id === "active") await active.promise;
      },
    });
    queue.setBusy(false);
    queue.enqueue(message("active"));
    await tick();
    queue.setBusy(true);
    queue.enqueue(message("later"));
    queue.enqueue(message("now"));
    const sent = queue.sendNow("now");
    await tick();
    expect(events).toEqual(["active", "cancel"]);
    cancellation.resolve();
    await sent;
    await tick();
    await tick();
    expect(events).toEqual(["active", "cancel", "now", "later"]);
  });

  it("keeps queued messages on cancellation failure and allows retry", async () => {
    const queue = new ChatMessageQueue();
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    queue.attach({ prepare: async () => {}, cancel, send });
    queue.enqueue(message("one"));
    await queue.sendNow("one");
    expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({
      paused: true,
      messages: [message("one")],
    });
    await queue.sendNow("one");
    await tick();
    expect(send).toHaveBeenCalledOnce();
  });

  it("pauses after Stop and does not send while detached; remount retains pending items", async () => {
    const queue = new ChatMessageQueue();
    const prepared = deferred();
    const send = vi.fn().mockResolvedValue(undefined);
    const detach = queue.attach({
      prepare: () => prepared.promise,
      cancel: async () => {},
      send,
    });
    queue.enqueue(message("one"));
    queue.pause();
    queue.setBusy(false);
    await tick();
    expect(send).not.toHaveBeenCalled();
    const now = queue.sendNow("one");
    await tick();
    detach();
    prepared.resolve();
    await now;
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot().messages).toHaveLength(1);
    queue.attach({ prepare: async () => {}, cancel: async () => {}, send });
    queue.setBusy(false);
    await tick();
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps a message when server finalization fails", async () => {
    const queue = new ChatMessageQueue();
    const send = vi.fn();
    queue.attach({
      prepare: async () => {
        throw new Error("still running");
      },
      cancel: async () => {},
      send,
    });
    queue.setBusy(false);
    queue.enqueue(message("one"));
    await tick();
    expect(queue.getSnapshot()).toMatchObject({
      paused: true,
      messages: [message("one")],
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("releases a detached reader and ignores its late failure after remount", async () => {
    const queue = new ChatMessageQueue();
    let rejectOld!: (error: Error) => void;
    const oldReader = new Promise<void>((_, reject) => {
      rejectOld = reject;
    });
    const detach = queue.attach({
      prepare: async () => {},
      cancel: async () => {},
      send: () => oldReader,
    });
    queue.setBusy(false);
    queue.enqueue(message("active"));
    await tick();
    queue.setBusy(true);
    queue.enqueue(message("next"));
    detach();
    const send = vi.fn().mockResolvedValue(undefined);
    queue.attach({ prepare: async () => {}, cancel: async () => {}, send });
    queue.setBusy(false);
    await tick();
    expect(send).toHaveBeenCalledWith(message("next"));
    rejectOld(new Error("old reader failed"));
    await tick();
    expect(queue.getSnapshot()).toMatchObject({ paused: false, error: null });
  });

  it("Send now does not wait for a stale reader after cancellation is confirmed", async () => {
    const queue = new ChatMessageQueue();
    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(undefined);
    queue.attach({ prepare: async () => {}, cancel: async () => {}, send });
    queue.setBusy(false);
    queue.enqueue(message("active"));
    await tick();
    queue.setBusy(true);
    queue.enqueue(message("next"));
    await queue.sendNow("next");
    await tick();
    expect(send.mock.calls.map(([item]) => item.id)).toEqual([
      "active",
      "next",
    ]);
  });

  it("a newer Stop defeats a pending Send now even when cancellation resolves late", async () => {
    const queue = new ChatMessageQueue();
    const cancellation = deferred();
    const send = vi.fn().mockResolvedValue(undefined);
    let signal!: AbortSignal;
    queue.attach({
      prepare: async () => {},
      cancel: (current) => {
        signal = current;
        return cancellation.promise;
      },
      send,
    });
    queue.enqueue(message("next"));
    const sending = queue.sendNow("next");
    queue.pause();
    expect(signal.aborted).toBe(true);
    cancellation.resolve();
    await sending;
    queue.setBusy(false);
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toMatchObject({
      paused: true,
      sendingId: null,
      messages: [message("next")],
    });
  });
});

describe("chat queue lifetime", () => {
  it("retains pending drafts across navigation but releases empty queues", () => {
    const store = getChatQueueStore({});
    const queue = store.get("server:user", "chat");
    const release = store.retain("server:user", "chat", queue);
    queue.enqueue(message("pending"));
    release();
    expect(store.get("server:user", "chat")).toBe(queue);
    const releaseAgain = store.retain("server:user", "chat", queue);
    queue.remove("pending");
    releaseAgain();
    expect(store.get("server:user", "chat")).not.toBe(queue);
  });

  it("isolates owners and clears pending cancellation when a chat or session is removed", async () => {
    const owner = {};
    const store = getChatQueueStore(owner);
    expect(getChatQueueStore(owner)).toBe(store);
    expect(getChatQueueStore({})).not.toBe(store);
    const queue = store.get("server:user", "chat");
    store.retain("server:user", "chat", queue);
    expect(store.get("other-server:user", "chat")).not.toBe(queue);
    const cancelled = deferred();
    const send = vi.fn();
    queue.attach({
      prepare: async () => {},
      cancel: () => cancelled.promise,
      send,
    });
    queue.enqueue(message("pending"));
    const sending = queue.sendNow("pending");
    store.deleteChat("chat");
    cancelled.resolve();
    await sending;
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(queue.getSnapshot().messages).toEqual([]);
    expect(store.get("server:user", "chat")).not.toBe(queue);
    const another = store.get("server:user", "another");
    store.retain("server:user", "another", another);
    another.enqueue(message("private draft"));
    store.clear();
    expect(another.getSnapshot().messages).toEqual([]);
    expect(store.get("server:user", "another")).not.toBe(another);
  });
});
