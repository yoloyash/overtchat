import { describe, expect, it, vi } from "vitest";
import { ChatMessageQueue, type QueuedChatMessage } from "@overtchat/shared";

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
});
