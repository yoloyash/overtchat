import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PRESENCE_WINDOW_MS,
  AgentClientRegistry,
  planAgentNotification,
  type AgentClientPresence,
} from "./presence";

function client(
  overrides: Partial<AgentClientPresence> = {},
): AgentClientPresence {
  return {
    clientId: "tab",
    at: 100_000,
    visible: true,
    viewing: null,
    notify: true,
    ...overrides,
  };
}

describe("planning who hears about a session", () => {
  const now = 100_000;

  it("tells the client used most recently and keeps phones quiet", () => {
    expect(
      planAgentNotification(
        [
          client({ clientId: "old", at: now - 50_000 }),
          client({ clientId: "new", at: now - 10_000 }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipient: "new", push: false });
  });

  it("tells nobody while a present client shows the session", () => {
    expect(
      planAgentNotification(
        [
          client({ clientId: "other", at: now }),
          client({ clientId: "viewer", at: now - 60_000, viewing: "s", notify: false }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipient: null, push: false });
    // Not when that client is hidden or shows another session.
    expect(
      planAgentNotification([client({ viewing: "s", visible: false })], "s", now)
        .recipient,
    ).toBe("tab");
    expect(
      planAgentNotification([client({ viewing: "t" })], "s", now).recipient,
    ).toBe("tab");
  });

  it("pushes when no present client wants alerts", () => {
    expect(planAgentNotification([], "s", now)).toEqual({
      recipient: null,
      push: true,
    });
    expect(
      planAgentNotification(
        [
          client({ notify: false }),
          client({ clientId: "gone", at: now - AGENT_PRESENCE_WINDOW_MS - 1 }),
          client({ clientId: "gone-viewer", at: now - AGENT_PRESENCE_WINDOW_MS - 1, viewing: "s" }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipient: null, push: true });
  });
});

describe("the client registry", () => {
  it("counts a client as wanting alerts only while its stream is attached", () => {
    const registry = new AgentClientRegistry();
    registry.record("u", { clientId: "tab", visible: true, viewing: "s", notify: true }, 1_000);
    expect(registry.clients("u", 2_000)).toEqual([
      { clientId: "tab", at: 1_000, visible: true, viewing: "s", notify: false },
    ]);
    const sink = vi.fn();
    const stop = registry.subscribe("u", "tab", sink, 2_000);
    expect(registry.clients("u", 2_000)[0]?.notify).toBe(true);
    const notification = {
      sessionId: "s",
      reason: "completed" as const,
      eventId: "e",
      title: "Finished: s",
      body: "Done.",
      provider: "codex" as const,
    };
    expect(registry.deliver("u", "tab", notification)).toBe(true);
    expect(sink).toHaveBeenCalledExactlyOnceWith(notification);
    // Without a stream the client cannot be looking at anything.
    stop();
    expect(registry.clients("u", 2_000)).toEqual([
      { clientId: "tab", at: 1_000, visible: false, viewing: null, notify: false },
    ]);
    expect(registry.deliver("u", "tab", notification)).toBe(false);
    expect(registry.deliver("v", "tab", notification)).toBe(false);
  });

  it("keeps a client attached until its last stream closes, telling the newest", () => {
    const registry = new AgentClientRegistry();
    registry.record("u", { clientId: "page", visible: true, viewing: null, notify: true }, 1_000);
    const notification = {
      sessionId: "s",
      reason: "approval" as const,
      eventId: "e",
      title: "Needs approval: s",
      body: "Allow Bash",
      provider: "codex" as const,
    };
    // A phone's drawer runs a second copy of the sidebar, with its own stream.
    const panel = vi.fn();
    const drawer = vi.fn();
    const stopPanel = registry.subscribe("u", "page", panel, 1_000);
    const stopDrawer = registry.subscribe("u", "page", drawer, 1_500);
    expect(registry.deliver("u", "page", notification)).toBe(true);
    expect(drawer).toHaveBeenCalledExactlyOnceWith(notification);
    expect(panel).not.toHaveBeenCalled();
    // Closing the drawer leaves the panel's stream, and the client's presence.
    stopDrawer();
    expect(registry.clients("u", 2_000)[0]).toMatchObject({ visible: true, notify: true });
    expect(registry.deliver("u", "page", notification)).toBe(true);
    expect(panel).toHaveBeenCalledExactlyOnceWith(notification);
    stopPanel();
    expect(registry.clients("u", 2_000)[0]).toMatchObject({ visible: false, notify: false });
    expect(registry.deliver("u", "page", notification)).toBe(false);
  });

  it("forgets clients that stopped reporting in", () => {
    const registry = new AgentClientRegistry();
    registry.record("u", { clientId: "old", visible: true, viewing: null, notify: true }, 1_000);
    registry.record("u", { clientId: "new", visible: true, viewing: null, notify: true }, 1_000 + AGENT_PRESENCE_WINDOW_MS + 1);
    expect(registry.clients("u", 1_000 + AGENT_PRESENCE_WINDOW_MS + 1).map((c) => c.clientId)).toEqual(["new"]);
  });
});
