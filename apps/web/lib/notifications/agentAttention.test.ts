import type { AgentSessionDirectoryEntry } from "@overtchat/agent-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAttentionNotifications } from "./agentAttention";

const approval = {
  kind: "approval" as const,
  id: "request-1",
  requestedAt: 1_000,
  title: "Allow Bash",
  detail: "npm ci",
};

function entry(
  overrides: Partial<AgentSessionDirectoryEntry> = {},
): AgentSessionDirectoryEntry {
  return {
    sessionId: "a",
    runtimeStatus: "idle",
    turnStartedAt: null,
    attention: null,
    lastTurn: null,
    ...overrides,
  };
}

function turn(
  outcome: "completed" | "failed" | "stopped",
  endedAt: number,
): AgentSessionDirectoryEntry {
  return entry({
    lastTurn: { outcome, startedAt: endedAt - 1_000, endedAt, preview: "Done." },
  });
}

describe("agent attention notifications", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup() {
    const notify = vi.fn();
    const tracker = new AgentAttentionNotifications(notify);
    tracker.reset("a", entry());
    return { notify, tracker };
  }

  it("reports a new request at once, with what it asks", () => {
    const { tracker, notify } = setup();
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.update("a", entry({ runtimeStatus: "running", attention: approval }));
    tracker.update("a", entry({ runtimeStatus: "running", attention: approval }));
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      sessionId: "a",
      reason: "approval",
      eventId: "a:request-1",
      attention: approval,
    });
    // Answering it is the owner's own doing; the next request is new.
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.update(
      "a",
      entry({
        runtimeStatus: "running",
        attention: { ...approval, kind: "question", id: "request-2" },
      }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "question", eventId: "a:request-2" }),
    );
  });

  it("reports a finished turn once it has settled, and a failed one at once", () => {
    const { tracker, notify } = setup();
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.update("a", turn("completed", 5_000));
    tracker.update("a", turn("completed", 5_000));
    vi.advanceTimersByTime(4_999);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      sessionId: "a",
      reason: "completed",
      eventId: "a:5000",
      turn: expect.objectContaining({ outcome: "completed", endedAt: 5_000 }),
    });
    tracker.update("a", entry({ runtimeStatus: "running", lastTurn: turn("completed", 5_000).lastTurn }));
    tracker.update("a", turn("failed", 9_000));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "failed", eventId: "a:9000" }),
    );
  });

  it("drops a finished turn when work resumes or a request arrives first", () => {
    const { tracker, notify } = setup();
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.update("a", turn("completed", 5_000));
    vi.advanceTimersByTime(3_000);
    tracker.update("a", { ...turn("completed", 5_000), runtimeStatus: "running" });
    vi.advanceTimersByTime(5_000);
    expect(notify).not.toHaveBeenCalled();
    tracker.update("a", turn("completed", 8_000));
    vi.advanceTimersByTime(1_000);
    tracker.update("a", { ...turn("completed", 8_000), attention: approval });
    vi.advanceTimersByTime(5_000);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: "approval" }),
    );
  });

  it("stays quiet for stopped turns, snapshots, and disconnects", () => {
    const { tracker, notify } = setup();
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.update("a", turn("stopped", 5_000));
    tracker.reset("a", entry({ runtimeStatus: "running" }));
    tracker.reset("a", turn("completed", 6_000));
    tracker.reset("a", entry({ runtimeStatus: "running", attention: approval }));
    tracker.update("a", { ...turn("completed", 7_000), runtimeStatus: "running" });
    tracker.reset("a");
    tracker.update("a", turn("completed", 8_000));
    vi.advanceTimersByTime(10_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("suppresses an explicit Stop and rearms for the next run", () => {
    const { tracker, notify } = setup();
    tracker.update("a", entry({ runtimeStatus: "running" }));
    tracker.suppress("a");
    tracker.update("a", turn("completed", 5_000));
    vi.advanceTimersByTime(5_000);
    expect(notify).not.toHaveBeenCalled();
    tracker.update("a", { ...turn("completed", 5_000), runtimeStatus: "running" });
    tracker.update("a", turn("completed", 9_000));
    vi.advanceTimersByTime(5_000);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: "completed", eventId: "a:9000" }),
    );
  });

  it("falls back to the status for connectors without turn summaries", () => {
    const notify = vi.fn();
    const tracker = new AgentAttentionNotifications(notify);
    tracker.reset("a", { sessionId: "a", runtimeStatus: "idle" });
    tracker.update("a", { sessionId: "a", runtimeStatus: "running" });
    tracker.update("a", { sessionId: "a", runtimeStatus: "idle" });
    vi.advanceTimersByTime(5_000);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: "a", reason: "completed" }),
    );
    tracker.update("a", { sessionId: "a", runtimeStatus: "running" });
    tracker.update("a", { sessionId: "a", runtimeStatus: "exited" });
    vi.advanceTimersByTime(5_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
