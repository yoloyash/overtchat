import { describe, expect, it } from "vitest";
import type {
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import {
  applyEnvelopeToReplica,
  applyLegacyEnvelopeToReplica,
  applySyncToReplica,
  formatAgentRuntimeCursor,
  parseAgentRuntimeCursor,
  replicaFromOpenResult,
  resolveAgentSessionFetchRace,
  type AgentSessionReplica,
} from "./sessionReplica";

function snapshot(status: AgentRuntimeSnapshot["status"] = "idle") {
  return {
    sessionId: "session",
    provider: "codex",
    capabilities: { steer: true },
    status,
    activeTurn: null,
    state: {},
    messages: [],
    models: [],
    thinkingLevels: [],
    commands: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    },
    queuedMessages: [],
  } satisfies AgentRuntimeSnapshot;
}

function event(
  sequence: number,
  data: Record<string, unknown> = { type: "turn_start" },
): AgentRuntimeEnvelope {
  return {
    epoch: "epoch",
    sequence,
    type: "runtime_event",
    data: data as Extract<
      AgentRuntimeEnvelope,
      { type: "runtime_event" }
    >["data"],
  };
}

describe("agent session replica", () => {
  it("installs an authoritative reset atomically", () => {
    const authoritative = snapshot("running");
    const replica = replicaFromOpenResult({
      snapshot: snapshot(),
      sync: {
        reset: true,
        cursor: { epoch: "epoch", sequence: 7 },
        snapshot: authoritative,
      },
    });

    expect(replica).toEqual({
      snapshot: authoritative,
      cursor: { epoch: "epoch", sequence: 7 },
    });
  });

  it("rejects an authoritative reset for a different session", () => {
    expect(() =>
      replicaFromOpenResult({
        snapshot: snapshot(),
        sync: {
          reset: true,
          cursor: { epoch: "epoch", sequence: 1 },
          snapshot: { ...snapshot(), sessionId: "different-session" },
        },
      }),
    ).toThrow("different session");
  });

  it("applies a contiguous authoritative suffix to the returned snapshot", () => {
    const replica = replicaFromOpenResult(
      {
        snapshot: snapshot("running"),
        sync: {
          reset: false,
          cursor: { epoch: "epoch", sequence: 2 },
          events: [
            event(1),
            event(2, { type: "overtchat_status", status: "idle" }),
          ],
        },
      },
      { snapshot: snapshot(), cursor: { epoch: "epoch", sequence: 0 } },
    );

    expect(replica.cursor).toEqual({ epoch: "epoch", sequence: 2 });
    expect(replica.snapshot.status).toBe("idle");
  });

  it("applies only the exact next event and ignores duplicates", () => {
    const replica: AgentSessionReplica = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 4 },
    };

    const applied = applyEnvelopeToReplica(replica, event(5));
    expect(applied.type).toBe("applied");
    if (applied.type !== "applied") throw new Error("expected an update");
    expect(applied.replica.cursor?.sequence).toBe(5);
    expect(applied.replica.snapshot.status).toBe("running");
    expect(applyEnvelopeToReplica(applied.replica, event(5)).type).toBe(
      "duplicate",
    );
  });

  it("requires reconciliation for gaps, epoch changes, and unanchored deltas", () => {
    const anchored: AgentSessionReplica = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 4 },
    };
    expect(applyEnvelopeToReplica(anchored, event(6)).type).toBe("reconcile");
    expect(
      applyEnvelopeToReplica(anchored, { ...event(5), epoch: "new-epoch" }).type,
    ).toBe("reconcile");
    expect(
      applyEnvelopeToReplica({ snapshot: snapshot(), cursor: null }, event(1))
        .type,
    ).toBe("reconcile");
  });

  it("lets a legacy snapshot establish the first cursor", () => {
    const next = applyEnvelopeToReplica(
      { snapshot: snapshot(), cursor: null },
      {
        epoch: "legacy",
        sequence: 3,
        type: "snapshot",
        data: snapshot("running"),
      },
    );

    expect(next.type).toBe("applied");
    if (next.type !== "applied") throw new Error("expected an update");
    expect(next.replica.cursor).toEqual({ epoch: "legacy", sequence: 3 });
    expect(next.replica.snapshot.status).toBe("running");
  });

  it("allows only legacy same-epoch gaps and treats snapshots as boundaries", () => {
    const anchored: AgentSessionReplica = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 1 },
    };
    const forward = applyLegacyEnvelopeToReplica(anchored, event(3));
    expect(forward.type).toBe("applied");
    if (forward.type !== "applied") throw new Error("expected an update");
    expect(forward.replica.cursor).toEqual({ epoch: "epoch", sequence: 3 });

    const reset = applyLegacyEnvelopeToReplica(forward.replica, {
      epoch: "replacement",
      sequence: 8,
      type: "snapshot",
      data: snapshot("idle"),
    });
    expect(reset.type).toBe("applied");
    if (reset.type !== "applied") throw new Error("expected a reset");
    expect(reset.replica.cursor).toEqual({
      epoch: "replacement",
      sequence: 8,
    });

    expect(applyEnvelopeToReplica(anchored, event(3)).type).toBe("reconcile");
    expect(
      applyLegacyEnvelopeToReplica(anchored, {
        ...event(2),
        epoch: "replacement",
      }).type,
    ).toBe("reconcile");
  });

  it("drops a stale legacy cursor after an unversioned refetch", () => {
    expect(
      replicaFromOpenResult(
        { snapshot: snapshot("running") },
        {
          snapshot: snapshot(),
          cursor: { epoch: "old-runtime", sequence: 12 },
        },
      ),
    ).toEqual({ snapshot: snapshot("running"), cursor: null });
  });

  it("rejects a sync suffix that does not continue the local cursor", () => {
    expect(
      applySyncToReplica(
        {
          snapshot: snapshot(),
          cursor: { epoch: "epoch", sequence: 2 },
        },
        {
          reset: false,
          cursor: { epoch: "epoch", sequence: 4 },
          events: [event(4)],
        },
      ),
    ).toBeNull();
  });

  it("round-trips runtime cursors", () => {
    const cursor = { epoch: "runtime:epoch", sequence: 42 };
    expect(parseAgentRuntimeCursor(formatAgentRuntimeCursor(cursor))).toEqual(
      cursor,
    );
    expect(parseAgentRuntimeCursor("runtime:not-a-number")).toBeUndefined();
  });

  it("keeps whichever same-epoch replica won a fetch race", () => {
    const baseline = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 4 },
    };
    const live = {
      snapshot: snapshot("running"),
      cursor: { epoch: "epoch", sequence: 5 },
    };
    const fetched = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 6 },
    };

    expect(resolveAgentSessionFetchRace(baseline, live, fetched)).toBe(fetched);
    expect(
      resolveAgentSessionFetchRace(baseline, live, {
        ...fetched,
        cursor: { epoch: "epoch", sequence: 4 },
      }),
    ).toBe(live);
    expect(
      resolveAgentSessionFetchRace(baseline, { ...live, cursor: null }, fetched),
    ).toBe(fetched);
  });

  it("does not roll back a live cached replica when a remount fetch returns", () => {
    const live = {
      snapshot: snapshot("running"),
      cursor: { epoch: "epoch", sequence: 5 },
    };
    const staleFetch = {
      snapshot: snapshot(),
      cursor: { epoch: "epoch", sequence: 4 },
    };

    expect(resolveAgentSessionFetchRace(undefined, live, staleFetch)).toBe(live);
  });

  it("uses an authoritative fetch to cross an epoch boundary", () => {
    const baseline = {
      snapshot: snapshot(),
      cursor: { epoch: "old", sequence: 4 },
    };
    const live = {
      snapshot: snapshot("running"),
      cursor: { epoch: "old", sequence: 5 },
    };
    const fetched = {
      snapshot: snapshot(),
      cursor: { epoch: "new", sequence: 1 },
    };

    expect(resolveAgentSessionFetchRace(baseline, live, fetched)).toBe(fetched);
  });

  it("does not let a delayed old-epoch fetch overwrite a newer live epoch", () => {
    const baseline = {
      snapshot: snapshot(),
      cursor: { epoch: "old", sequence: 4 },
    };
    const live = {
      snapshot: snapshot("running"),
      cursor: { epoch: "new", sequence: 2 },
    };
    const delayed = {
      snapshot: snapshot(),
      cursor: { epoch: "old", sequence: 7 },
    };

    expect(resolveAgentSessionFetchRace(baseline, live, delayed)).toBe(live);
    expect(
      resolveAgentSessionFetchRace(baseline, live, {
        ...delayed,
        cursor: { epoch: "other-new", sequence: 1 },
      }),
    ).toBe(live);
  });
});
