import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceHistoryItem } from "@overtchat/shared";
import { VoiceHistorySaveError, VoiceHistorySync } from "./history-sync";

const item = (text = "Hello"): VoiceHistoryItem => ({
  type: "message", id: "one", previousId: null, role: "assistant", status: "completed", text,
});

describe("acknowledged voice history", () => {
  afterEach(() => vi.useRealTimers());

  it("retries an unchanged failed batch without needing another transcript event", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(undefined);
    const warning = vi.fn();
    const sync = new VoiceHistorySync(save, warning);
    sync.enqueue([item()]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual([item()]);
    expect(warning).toHaveBeenLastCalledWith(null);
    sync.enqueue([item()]);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("serializes a correction behind its in-flight save and never ACKs it early", async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const sync = new VoiceHistorySync(save, vi.fn());
    sync.enqueue([item()]);
    sync.enqueue([item("Hello again")]);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual([item("Hello again")]);
  });

  it("keeps the latest value even when it matches an earlier ACK", async () => {
    let finish!: () => void;
    const save = vi.fn().mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const sync = new VoiceHistorySync(save, vi.fn());
    sync.enqueue([item()]);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    sync.enqueue([item("Hello again")]);
    sync.enqueue([item()]);
    finish();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2][0]).toEqual([item()]);
  });

  it("keeps rejected items for an explicit retry without hammering an expired session", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new VoiceHistorySaveError(false)).mockResolvedValue(undefined);
    const sync = new VoiceHistorySync(save, vi.fn());
    sync.enqueue([item()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    sync.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
