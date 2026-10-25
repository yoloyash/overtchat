import type { AgentSessionDirectoryEntry } from "@overtchat/agent-bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DirectoryEvent =
  | { type: "snapshot"; sessions: AgentSessionDirectoryEntry[] }
  | { type: "update"; session: AgentSessionDirectoryEntry };

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAgentConnections: vi.fn(),
  subscribeSessionDirectory: vi.fn(),
  unsubscribeDirectory: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  watchWorkspaceGit: vi.fn(),
  unwatchGit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listAgentConnections: mocks.listAgentConnections,
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    subscribeSessionDirectory: mocks.subscribeSessionDirectory,
    watchWorkspaceGit: mocks.watchWorkspaceGit,
  },
}));

import { GET } from "./route";

describe("agent connection session-directory stream", () => {
  let listener: ((event: DirectoryEvent) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.listAgentConnections.mockResolvedValue([
      {
        host: { connectorId: "connector" },
        workspaces: [
          {
            sessions: [{ id: "session" }, { id: "other-session" }],
          },
        ],
      },
    ]);
    mocks.subscribeSessionDirectory.mockImplementation(
      (
        _sessionIds: string[],
        subscriber: (event: DirectoryEvent) => void,
      ) => {
        listener = subscriber;
        subscriber({
          type: "snapshot",
          sessions: [
            { sessionId: "session", runtimeStatus: "idle" },
            { sessionId: "other-session", runtimeStatus: "exited" },
          ],
        });
        return mocks.unsubscribeDirectory;
      },
    );
  });

  it("streams an authorized snapshot and session upserts, then cleans up", async () => {
    const response = await GET(
      new Request("http://server.test/api/agent-connections/events"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    expect(mocks.subscribeSessionDirectory).toHaveBeenCalledWith(
      ["session", "other-session"],
      expect.any(Function),
    );
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain("event: snapshot");
    expect(initial).toContain(
      JSON.stringify({
        sessions: [
          { sessionId: "session", runtimeStatus: "idle" },
          { sessionId: "other-session", runtimeStatus: "exited" },
        ],
      }),
    );

    listener?.({
      type: "update",
      session: { sessionId: "session", runtimeStatus: "running" },
    });
    const running = new TextDecoder().decode((await reader.read()).value);
    expect(running).toContain("event: update");
    expect(running).toContain(
      JSON.stringify({ sessionId: "session", runtimeStatus: "running" }),
    );
    await reader.cancel();
    expect(mocks.unsubscribeDirectory).toHaveBeenCalledOnce();
  });

  it("does not expose the directory to non-admin users", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await GET(
      new Request("http://server.test/api/agent-connections/events"),
    );

    expect(response.status).toBe(403);
    expect(mocks.listAgentConnections).not.toHaveBeenCalled();
    expect(mocks.subscribeSessionDirectory).not.toHaveBeenCalled();
  });

  it("streams Git watch events only for owned requested workspaces", async () => {
    mocks.getOwnedAgentWorkspace.mockImplementation(async (id: string) =>
      id === "owned"
        ? {
            host: { connectorId: "connector", transport: "ssh", sshAlias: "box" },
            connection: { shellMode: "login" },
            workspace: { id: "owned", path: "/srv/project" },
          }
        : null,
    );
    let gitListener:
      | ((event: { type: "live"; live: boolean }) => void)
      | undefined;
    mocks.watchWorkspaceGit.mockImplementation((_target, listener) => {
      gitListener = listener;
      return mocks.unwatchGit;
    });

    const response = await GET(
      new Request(
        "http://server.test/api/agent-connections/events?git=owned,foreign,owned",
      ),
    );

    expect(mocks.getOwnedAgentWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.watchWorkspaceGit).toHaveBeenCalledOnce();
    expect(mocks.watchWorkspaceGit).toHaveBeenCalledWith(
      {
        connectorId: "connector",
        workspaceId: "owned",
        target: { transport: "ssh", alias: "box", shellMode: "login" },
        path: "/srv/project",
      },
      expect.any(Function),
    );
    const reader = response.body!.getReader();
    await reader.read();
    gitListener?.({ type: "live", live: true });
    const live = new TextDecoder().decode((await reader.read()).value);
    expect(live).toBe(
      `event: git\ndata: ${JSON.stringify({ workspaceId: "owned", live: true })}\n\n`,
    );
    await reader.cancel();
    expect(mocks.unwatchGit).toHaveBeenCalledOnce();
  });
});
