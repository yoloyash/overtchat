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
    activeAt: 100_000,
    visible: true,
    viewing: null,
    notify: true,
    ...overrides,
  };
}

describe("planning who hears about a session", () => {
  const now = 100_000;
  const idle = now - AGENT_PRESENCE_WINDOW_MS - 1;

  it("tells the client used most recently and keeps phones quiet", () => {
    expect(
      planAgentNotification(
        [
          client({ clientId: "old", activeAt: now - 50_000 }),
          client({ clientId: "new", activeAt: now - 10_000 }),
          client({ clientId: "idle", activeAt: idle }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipients: ["new"], push: false });
  });

  it("tells nobody while a client in use shows the session", () => {
    expect(
      planAgentNotification(
        [
          client({ clientId: "other", activeAt: now }),
          client({ clientId: "viewer", activeAt: now - 60_000, viewing: "s", notify: false }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipients: [], push: false });
    // Not when that client is hidden, shows another session, or was left open.
    for (const other of [
      client({ viewing: "s", visible: false }),
      client({ viewing: "t" }),
    ]) {
      expect(planAgentNotification([other], "s", now)).toEqual({
        recipients: ["tab"],
        push: false,
      });
    }
    expect(
      planAgentNotification([client({ viewing: "s", activeAt: idle })], "s", now),
    ).toEqual({ recipients: ["tab"], push: true });
  });

  it("tells every connected client and the phones when none is in use", () => {
    expect(planAgentNotification([], "s", now)).toEqual({
      recipients: [],
      push: true,
    });
    expect(
      planAgentNotification(
        [
          client({ clientId: "background-tab", activeAt: idle, visible: false }),
          client({ clientId: "left-open", activeAt: idle - 60_000 }),
          client({ clientId: "alerts-off", activeAt: idle, notify: false }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipients: ["background-tab", "left-open"], push: true });
    // A client in use that wants no alerts leaves them to the others.
    expect(
      planAgentNotification(
        [
          client({ clientId: "alerts-off", notify: false }),
          client({ clientId: "background-tab", activeAt: idle, visible: false }),
        ],
        "s",
        now,
      ),
    ).toEqual({ recipients: ["background-tab"], push: true });
  });
});

describe("the client registry", () => {
  it("counts a client as wanting alerts only while its stream is attached", () => {
    const registry = new AgentClientRegistry();
    registry.record("u", { clientId: "tab", visible: true, viewing: "s", notify: true }, 1_000);
    expect(registry.clients("u", 2_000)).toEqual([
      { clientId: "tab", activeAt: 1_000, visible: true, viewing: "s", notify: false },
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
      { clientId: "tab", activeAt: 1_000, visible: false, viewing: null, notify: false },
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

  it("dates a client's use by how long it says it sat idle", () => {
    const registry = new AgentClientRegistry();
    registry.record(
      "u",
      { clientId: "tab", visible: true, viewing: null, notify: true, idleMs: 400 },
      1_000,
    );
    expect(registry.clients("u", 1_000)[0]?.activeAt).toBe(600);
    // A client that predates this counts as used whenever it reports in.
    registry.record("u", { clientId: "tab", visible: true, viewing: null, notify: true }, 2_000);
    expect(registry.clients("u", 2_000)[0]?.activeAt).toBe(2_000);
  });

  it("keeps a quiet client while its stream is attached, and forgets it after", () => {
    const registry = new AgentClientRegistry();
    const later = 1_000 + AGENT_PRESENCE_WINDOW_MS + 1;
    registry.record("u", { clientId: "closed", visible: true, viewing: null, notify: true }, 1_000);
    registry.record("u", { clientId: "background", visible: false, viewing: null, notify: true }, 1_000);
    const stop = registry.subscribe("u", "background", vi.fn(), 1_000);
    registry.record("u", { clientId: "new", visible: true, viewing: null, notify: true }, later);
    expect(registry.clients("u", later)).toEqual([
      { clientId: "background", activeAt: 1_000, visible: false, viewing: null, notify: true },
      { clientId: "new", activeAt: later, visible: true, viewing: null, notify: false },
    ]);
    stop();
    expect(registry.clients("u", later).map((c) => c.clientId)).toEqual(["new"]);
  });
});
