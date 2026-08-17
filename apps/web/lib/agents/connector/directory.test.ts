import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  runtimeStatusForSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    runtimeStatusForSession: mocks.runtimeStatusForSession,
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
          },
        ],
      },
    ],
  },
];

describe("connector session directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeStatusForSession.mockReturnValue("running");
  });

  it("overlays connector-projected status without mutating database data", () => {
    const result = withConnectorSessionDirectory(connections);

    expect(result[0]!.workspaces[0]!.sessions[0]!.runtimeStatus).toBe(
      "running",
    );
    expect(connections[0]!.workspaces[0]!.sessions[0]!.runtimeStatus).toBe(
      "idle",
    );
    expect(mocks.runtimeStatusForSession).toHaveBeenCalledWith("session");
  });
});
