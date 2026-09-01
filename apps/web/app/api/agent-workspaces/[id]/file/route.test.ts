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

describe("agent workspace file route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: {
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "workstation",
        userId: "owner",
      },
      connection: { shellMode: "interactive" },
      workspace: { id: "workspace", path: "/srv/project" },
    });
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
    mocks.daemonRequest.mockResolvedValue({
      path: "src/index.ts",
      content: "export {};",
      size: 10,
      modifiedAt: 100,
    });
  });

  it("reads a workspace-confined file through local or SSH connectors", async () => {
    const response = await GET(
      new Request(
        "http://server.test/api/agent-workspaces/workspace/file?path=src%2Findex.ts",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "read_workspace_file",
      target: {
        transport: "ssh",
        alias: "workstation",
        shellMode: "interactive",
      },
      root: "/srv/project",
      path: "src/index.ts",
    });
  });

  it("rejects missing paths and incompatible connectors", async () => {
    expect(
      (
        await GET(
          new Request("http://server.test/api/agent-workspaces/workspace/file"),
          context,
        )
      ).status,
    ).toBe(400);

    mocks.supports.mockReturnValueOnce(false);
    const response = await GET(
      new Request(
        "http://server.test/api/agent-workspaces/workspace/file?path=README.md",
      ),
      context,
    );
    expect(response.status).toBe(426);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
