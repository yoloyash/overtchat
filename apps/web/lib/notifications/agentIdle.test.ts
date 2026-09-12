import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentIdleNotifications } from "./agentIdle";

describe("agent idle notifications", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup() {
    const notify = vi.fn();
    return {
      notify,
      tracker: new AgentIdleNotifications(notify),
    };
  }
  it("notifies once for a live running-to-idle transition after settling", () => {
    const { tracker, notify } = setup();
    tracker.reset("a", "idle");
    tracker.update("a", "running");
    tracker.update("a", "idle");
    tracker.update("a", "idle");
    vi.advanceTimersByTime(4999);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith("a");
  });
  it("cancels the alert when queued work resumes", () => {
    const { tracker, notify } = setup();
    tracker.reset("a", "running");
    tracker.update("a", "idle");
    vi.advanceTimersByTime(3000);
    tracker.update("a", "running");
    vi.advanceTimersByTime(5000);
    expect(notify).not.toHaveBeenCalled();
    tracker.update("a", "idle");
    vi.advanceTimersByTime(5000);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("ignores initial idle, snapshots, exit, and disconnects", () => {
    const { tracker, notify } = setup();
    tracker.update("a", "idle");
    tracker.reset("a", "running");
    tracker.reset("a", "idle");
    tracker.update("a", "running");
    tracker.update("a", "exited");
    tracker.update("a", "running");
    tracker.update("a", "idle");
    tracker.reset("a");
    vi.advanceTimersByTime(10_000);
    expect(notify).not.toHaveBeenCalled();
  });
  it("suppresses an explicit Stop and rearms for the next run", () => {
    const { tracker, notify } = setup();
    tracker.update("a", "running");
    tracker.suppress("a");
    tracker.update("a", "idle");
    vi.advanceTimersByTime(5000);
    expect(notify).not.toHaveBeenCalled();
    tracker.update("a", "running");
    tracker.update("a", "idle");
    vi.advanceTimersByTime(5000);
    expect(notify).toHaveBeenCalledExactlyOnceWith("a");
  });
});
