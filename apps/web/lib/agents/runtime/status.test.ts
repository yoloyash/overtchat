import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectionListItem } from "@/lib/agents/types";

const mocks = vi.hoisted(() => ({
  runtimeStatusForSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/runtime/registry", () => ({
  agentRuntimeRegistry: {
    runtimeStatusForSession: mocks.runtimeStatusForSession,
  },
}));

import { withAgentRuntimeStatuses } from "./status";

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

describe("agent connection runtime statuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeStatusForSession.mockReturnValue("running");
  });

  it("overlays owner-scoped in-memory status without mutating database data", () => {
    const result = withAgentRuntimeStatuses(connections, "user");

    expect(result[0]!.workspaces[0]!.sessions[0]!.runtimeStatus).toBe(
      "running",
    );
    expect(connections[0]!.workspaces[0]!.sessions[0]!.runtimeStatus).toBe(
      "idle",
    );
    expect(mocks.runtimeStatusForSession).toHaveBeenCalledWith(
      "session",
      "user",
    );
  });
});
