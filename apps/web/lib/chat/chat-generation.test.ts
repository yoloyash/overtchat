import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGenerationCoordinator,
  type ChatGenerationState,
} from "@overtchat/shared";

const state = (
  active = false,
  status: ChatGenerationState["status"] = "complete",
): ChatGenerationState => ({
  active,
  status,
  streamId: "stream",
  startedAt: 1,
  completedAt: active ? null : 2,
});
function setup(status = "ready") {
  const adapter = {
    temporary: () => false,
    read: vi.fn().mockResolvedValue(state()),
    cancel: vi.fn().mockResolvedValue(undefined),
    stopReader: vi.fn(() => {
      generation.observeStatus("ready");
    }),
    resumeReader: vi.fn(() => {
      generation.observeStatus("streaming");
      return new Promise<void>(() => {});
    }),
    apply: vi.fn(),
    foreground: () => true,
  };
  const generation = new ChatGenerationCoordinator(status);
  const detach = generation.attach(adapter);
  return { generation, adapter, detach };
}
afterEach(() => vi.useRealTimers());

describe("generation coordination", () => {
  it("queue admission joins foreground recovery without cancelling inference or awaiting the resumed reader", async () => {
    vi.useFakeTimers();
    const { generation, adapter } = setup("streaming");
    adapter.read.mockResolvedValueOnce(state(true, "running"));
    const recovery = generation.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    const prepared = generation.prepare(new AbortController().signal, false);
    await vi.advanceTimersByTimeAsync(1500);
    await recovery;
    await expect(prepared).resolves.toBe(true);
    expect(adapter.resumeReader).toHaveBeenCalledOnce();
    expect(adapter.cancel).not.toHaveBeenCalled();
    expect(adapter.apply).toHaveBeenCalledWith(state());
  });

  it("waits for submit admission before cancelling and for reader completion before sending", async () => {
    vi.useFakeTimers();
    const { generation, adapter } = setup("submitted");
    adapter.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(state(true, "running"));
    adapter.stopReader.mockImplementation(() => {});
    const done = vi.fn();
    const cancelled = generation.cancel().then(done);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.cancel).not.toHaveBeenCalled();
    generation.observeStatus("streaming");
    await vi.advanceTimersByTimeAsync(250);
    expect(adapter.cancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    expect(done).not.toHaveBeenCalled();
    generation.observeStatus("ready");
    await cancelled;
    expect(done).toHaveBeenCalledOnce();
  });

  it("bounds cancellation when status requests never settle", async () => {
    vi.useFakeTimers();
    const { generation, adapter } = setup();
    adapter.read.mockImplementation(() => new Promise(() => {}));
    const cancelled = expect(generation.cancel()).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(30000);
    await cancelled;
    adapter.read.mockResolvedValue(state());
    await expect(generation.cancel()).resolves.toBeUndefined();
  });

  it("detach abandons hung recovery without cancelling server inference or applying late results", async () => {
    const { generation, adapter, detach } = setup();
    let resolve!: (value: ChatGenerationState) => void;
    adapter.read.mockReturnValue(
      new Promise<ChatGenerationState>((done) => {
        resolve = done;
      }),
    );
    const recovery = expect(generation.reconcile()).rejects.toThrow(
      "cancelled",
    );
    await Promise.resolve();
    detach();
    await recovery;
    resolve(state());
    await Promise.resolve();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(adapter.cancel).not.toHaveBeenCalled();
  });

  it.each(["aborted", "error"] as const)(
    "requires explicit Send now after server %s",
    async (status) => {
      const { generation, adapter } = setup();
      adapter.read.mockResolvedValue(state(false, status));
      await expect(
        generation.prepare(new AbortController().signal, false),
      ).resolves.toBe(false);
      await expect(
        generation.prepare(new AbortController().signal, true),
      ).resolves.toBe(true);
    },
  );
});
