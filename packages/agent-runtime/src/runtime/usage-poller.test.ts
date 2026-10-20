import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionStats } from "@overtchat/agent-bridge";
import { AgentUsagePoller } from "./usage-poller";

function stats(tokens: number): AgentSessionStats {
  return {
    sessionFile: null,
    sessionId: null,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: {
      input: tokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: tokens,
    },
    cost: 0,
    contextUsage: { tokens, contextWindow: 100000, percent: tokens / 1000 },
  };
}

afterEach(() => vi.useRealTimers());

describe("agent usage polling", () => {
  it("discards a pre-compaction read and reports the next current reading", async () => {
    vi.useFakeTimers();
    let resolve!: (value: AgentSessionStats) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AgentSessionStats>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(stats(12000));
    const publish = vi.fn();
    const poller = new AgentUsagePoller(read, publish);
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    poller.refresh();
    resolve(stats(90000));
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        contextUsage: expect.objectContaining({ tokens: 12000 }),
      }),
    );
    poller.stop();
  });

  it("ignores a pending read after stop and does not schedule another poll", async () => {
    vi.useFakeTimers();
    let resolve!: (value: AgentSessionStats) => void;
    const read = vi.fn(
      () =>
        new Promise<AgentSessionStats>((done) => {
          resolve = done;
        }),
    );
    const publish = vi.fn();
    const poller = new AgentUsagePoller(read, publish);
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    poller.stop();
    resolve(stats(90000));
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("recovers from transient errors without publishing an empty reading", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(stats(12));
    const publish = vi.fn();
    const poller = new AgentUsagePoller(read, publish);
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(publish).toHaveBeenCalledOnce();
    poller.stop();
  });
});
