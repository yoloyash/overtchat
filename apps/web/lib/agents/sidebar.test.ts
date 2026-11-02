import { describe, expect, it } from "vitest";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  agentConnectionHasRunningSession,
  agentSessionDisplayTitle,
  agentWorkspaceHasRunningSession,
  visibleAgentSessions,
  withAgentSessionDirectory,
  withAgentSessionReadState,
} from "./sidebar";

function sessions(count: number): AgentSessionListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    providerSessionId: `provider-${index}`,
    name: `Session ${index}`,
    firstMessage: null,
    messageCount: 0,
    createdAt: index,
    modifiedAt: index,
    runtimeStatus: "idle",
  }));
}

describe("agent sessions in the sidebar", () => {
  it("preserves legacy first-message titles while preferring persisted names", () => {
    expect(
      agentSessionDisplayTitle({
        name: "Persisted title",
        firstMessage: "Original prompt",
      }),
    ).toBe("Persisted title");
    expect(
      agentSessionDisplayTitle({
        name: null,
        firstMessage: "Legacy prompt title",
      }),
    ).toBe("Legacy prompt title");
    expect(
      agentSessionDisplayTitle({ name: null, firstMessage: null }),
    ).toBeNull();
  });

  it("shows only the recent preview until expanded", () => {
    const all = sessions(20);
    expect(visibleAgentSessions(all, false, null)).toHaveLength(
      AGENT_SESSION_PREVIEW_COUNT,
    );
    expect(visibleAgentSessions(all, true, null)).toEqual(all);
  });

  it("keeps an older active session visible without expanding everything", () => {
    const all = sessions(20);
    const visible = visibleAgentSessions(all, false, "session-15");
    expect(visible).toHaveLength(AGENT_SESSION_PREVIEW_COUNT + 1);
    expect(visible.at(-1)?.id).toBe("session-15");
  });

  it("keeps running sessions visible outside the recent preview", () => {
    const all = sessions(20);
    all[15]!.runtimeStatus = "running";

    const visible = visibleAgentSessions(all, false, "session-14");

    expect(visible.map((session) => session.id)).toEqual([
      ...all.slice(0, AGENT_SESSION_PREVIEW_COUNT).map((session) => session.id),
      "session-14",
      "session-15",
    ]);
  });

  it("keeps sessions waiting on the owner visible outside the recent preview", () => {
    const all = sessions(20);
    all[12]!.attention = {
      kind: "question",
      id: "request",
      requestedAt: 1,
      title: "Route",
    };
    all[16]!.lastTurn = { outcome: "completed", startedAt: 1, endedAt: 2 };
    all[18]!.lastTurn = { outcome: "completed", startedAt: 1, endedAt: 2 };
    all[18]!.readTurnEndedAt = 2;

    expect(
      visibleAgentSessions(all, false, null).map((session) => session.id),
    ).toEqual([
      ...all.slice(0, AGENT_SESSION_PREVIEW_COUNT).map((session) => session.id),
      "session-12",
      "session-16",
    ]);
  });

  it("reports running activity through workspace and connection ancestors", () => {
    const all = sessions(2);
    all[1]!.runtimeStatus = "running";
    const connection: AgentConnectionListItem = {
      id: "connection",
      provider: "pi",
      executable: "pi",
    detectedVersion: null,
    lastValidatedAt: null,
      host: {
        id: "host",
        connectorId: "connector",
        name: "This machine",
        transport: "local",
        sshAlias: null,
      },
      workspaces: [
        {
          id: "workspace",
          path: "/workspace",
          name: "workspace",
          sessions: all,
        },
      ],
    };

    expect(agentWorkspaceHasRunningSession(connection.workspaces[0]!)).toBe(
      true,
    );
    expect(agentConnectionHasRunningSession(connection)).toBe(true);
  });

  it("projects live status into the matching session with structural sharing", () => {
    const all = sessions(2);
    const connection: AgentConnectionListItem = {
      id: "connection",
      provider: "codex",
      executable: "codex",
    detectedVersion: null,
    lastValidatedAt: null,
      host: {
        id: "host",
        connectorId: "connector",
        name: "This machine",
        transport: "local",
        sshAlias: null,
      },
      workspaces: [
        {
          id: "workspace",
          path: "/workspace",
          name: "workspace",
          sessions: all,
        },
      ],
    };

    const connections = [connection];
    const running = withAgentSessionDirectory(connections, [
      { sessionId: "session-1", runtimeStatus: "running" },
    ]);
    expect(running).not.toBe(connections);
    expect(running[0]!.workspaces[0]!.sessions[0]).toBe(all[0]);
    expect(running[0]!.workspaces[0]!.sessions[1]!.runtimeStatus).toBe(
      "running",
    );
    expect(
      withAgentSessionDirectory(running, [
        { sessionId: "missing", runtimeStatus: "idle" },
      ]),
    ).toBe(running);

    const snapshot = withAgentSessionDirectory(running, [
      { sessionId: "session-0", runtimeStatus: "exited" },
      { sessionId: "session-1", runtimeStatus: "idle" },
    ]);
    expect(
      snapshot[0]!.workspaces[0]!.sessions.map(
        (session) => session.runtimeStatus,
      ),
    ).toEqual(["exited", "idle"]);
  });

  it("merges attention and turn results without regressing stored turns", () => {
    const stored = { outcome: "completed", startedAt: 1, endedAt: 2 } as const;
    const all = sessions(1).map((session) => ({ ...session, lastTurn: stored }));
    const connections = [
      {
        id: "connection",
        provider: "pi",
        executable: "pi",
        detectedVersion: null,
        lastValidatedAt: null,
        host: {
          id: "host",
          connectorId: "connector",
          name: "This machine",
          transport: "local",
          sshAlias: null,
        },
        workspaces: [{ id: "workspace", path: "/w", name: "w", sessions: all }],
      },
    ] satisfies AgentConnectionListItem[];
    const attention = {
      kind: "approval",
      id: "request",
      requestedAt: 5,
      title: "Allow Bash",
    } as const;
    const waiting = withAgentSessionDirectory(connections, [
      {
        sessionId: "session-0",
        runtimeStatus: "running",
        turnStartedAt: 3,
        attention,
        lastTurn: null,
      },
    ]);
    expect(waiting[0]!.workspaces[0]!.sessions[0]).toMatchObject({
      runtimeStatus: "running",
      turnStartedAt: 3,
      attention,
      lastTurn: stored,
    });
    // An identical entry leaves the cached list untouched.
    expect(
      withAgentSessionDirectory(waiting, [
        {
          sessionId: "session-0",
          runtimeStatus: "running",
          turnStartedAt: 3,
          attention: { ...attention },
        },
      ]),
    ).toBe(waiting);

    const finished = { outcome: "completed", startedAt: 3, endedAt: 9, preview: "Done." } as const;
    const done = withAgentSessionDirectory(waiting, [
      { sessionId: "session-0", runtimeStatus: "idle", lastTurn: finished },
    ]);
    expect(done[0]!.workspaces[0]!.sessions[0]).toMatchObject({
      runtimeStatus: "idle",
      turnStartedAt: null,
      attention: null,
      lastTurn: finished,
    });
  });

  it("moves a session's read watermark without touching other sessions", () => {
    const all = sessions(2);
    all[0]!.lastTurn = { outcome: "completed", startedAt: 1, endedAt: 50 };
    all[0]!.readTurnEndedAt = 10;
    const connections = [
      {
        id: "connection",
        provider: "pi",
        executable: "pi",
        detectedVersion: null,
        lastValidatedAt: null,
        host: {
          id: "host",
          connectorId: "connector",
          name: "This machine",
          transport: "local",
          sshAlias: null,
        },
        workspaces: [{ id: "workspace", path: "/w", name: "w", sessions: all }],
      },
    ] satisfies AgentConnectionListItem[];
    const read = withAgentSessionReadState(connections, "session-0", true);
    expect(read[0]!.workspaces[0]!.sessions[0]!.readTurnEndedAt).toBe(50);
    expect(read[0]!.workspaces[0]!.sessions[1]).toBe(all[1]);
    expect(withAgentSessionReadState(read, "session-0", true)).toBe(read);

    const unread = withAgentSessionReadState(read, "session-0", false);
    expect(unread[0]!.workspaces[0]!.sessions[0]!.readTurnEndedAt).toBe(49);
    // A session without a finished turn has nothing to mark.
    expect(withAgentSessionReadState(connections, "session-1", true)).toBe(
      connections,
    );
  });
});
