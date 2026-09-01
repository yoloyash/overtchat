import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  daemonRequest: vi.fn(),
  isOnline: vi.fn(),
  supports: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    request: mocks.daemonRequest,
    isOnline: mocks.isOnline,
    supports: mocks.supports,
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };

describe("agent workspace directory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: { connectorId: "connector", transport: "local", userId: "owner" },
      connection: { shellMode: "interactive" },
      workspace: { id: "workspace", path: "/srv/project" },
    });
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
    mocks.daemonRequest.mockResolvedValue({
      path: "src",
      entries: [
        {
          name: "index.ts",
          path: "src/index.ts",
          kind: "file",
          symlink: false,
        },
      ],
      truncated: false,
    });
  });

  it("lists a stored workspace directory through its connector", async () => {
    const response = await GET(
      new Request(
        "http://server.test/api/agent-workspaces/workspace/files?path=src",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "list_workspace_directory",
      target: { transport: "local", shellMode: "interactive" },
      root: "/srv/project",
      path: "src",
    });
  });

  it("requires ownership and a compatible connector", async () => {
    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect(
      (
        await GET(
          new Request("http://server.test/api/agent-workspaces/missing/files"),
          context,
        )
      ).status,
    ).toBe(404);

    mocks.supports.mockReturnValueOnce(false);
    const response = await GET(
      new Request("http://server.test/api/agent-workspaces/workspace/files"),
      context,
    );
    expect(response.status).toBe(426);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
