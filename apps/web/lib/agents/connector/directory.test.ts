import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  sessionDirectoryEntry: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    sessionDirectoryEntry: mocks.sessionDirectoryEntry,
  },
}));

import { withConnectorSessionDirectory } from "./directory";

const connections: AgentConnectionListItem[] = [
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
    workspaces: [
      {
        id: "workspace",
        path: "/workspace",
        name: "workspace",
        sessions: [
          {
            id: "session",
            providerSessionId: "native-session",
            name: "Session",
            firstMessage: null,
            messageCount: 0,
            createdAt: null,
            modifiedAt: null,
            runtimeStatus: "idle",
            lastTurn: {
              outcome: "completed",
              startedAt: 10,
              endedAt: 20,
              preview: "Stored reply",
            },
            readTurnEndedAt: 15,
          },
        ],
      },
    ],
  },
];

describe("connector session directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionDirectoryEntry.mockReturnValue({
      sessionId: "session",
      runtimeStatus: "running",
      turnStartedAt: 30,
      attention: {
        kind: "question",
        id: "request",
        requestedAt: 40,
        title: "Route",
      },
      // A restarted runtime has not finished a turn yet.
      lastTurn: null,
    });
  });

  it("overlays connector-projected status without mutating database data", () => {
    const result = withConnectorSessionDirectory(connections);
    expect(result[0]!.workspaces[0]!.sessions[0]).toMatchObject({
      runtimeStatus: "running",
      turnStartedAt: 30,
      attention: { id: "request" },
      lastTurn: { endedAt: 20, preview: "Stored reply" },
      readTurnEndedAt: 15,
    });
    expect(connections[0]!.workspaces[0]!.sessions[0]!.runtimeStatus).toBe(
      "idle",
    );
    expect(mocks.sessionDirectoryEntry).toHaveBeenCalledWith("session");
  });

  it("prefers a newer live turn over the stored one", () => {
    const live = { outcome: "failed", startedAt: 30, endedAt: 50, error: "Boom" } as const;
    mocks.sessionDirectoryEntry.mockReturnValue({
      sessionId: "session",
      runtimeStatus: "idle",
      lastTurn: live,
    });
    const [session] = withConnectorSessionDirectory(connections)[0]!.workspaces[0]!.sessions;
    expect(session).toMatchObject({
      runtimeStatus: "idle",
      turnStartedAt: null,
      attention: null,
      lastTurn: live,
    });
  });
});
