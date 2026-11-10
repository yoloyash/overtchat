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

describe("agent workspace file diff route", () => {
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
      path: "src/new.ts",
      patch: "@@ -1 +1 @@\n-a\n+b\n",
      truncated: false,
      binary: false,
    });
  });

  it("reads one file's changes, with the old path of a rename", async () => {
    const response = await GET(
      new Request(
        "http://server.test/api/agent-workspaces/workspace/file-diff?path=src%2Fnew.ts&originalPath=src%2Fold.ts",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      diff: {
        path: "src/new.ts",
        patch: "@@ -1 +1 @@\n-a\n+b\n",
        truncated: false,
        binary: false,
      },
    });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "read_workspace_file_diff",
      target: {
        transport: "ssh",
        alias: "workstation",
        shellMode: "interactive",
      },
      root: "/srv/project",
      path: "src/new.ts",
      originalPath: "src/old.ts",
    });
  });

  it("rejects strangers, missing paths and connectors without file diffs", async () => {
    const url =
      "http://server.test/api/agent-workspaces/workspace/file-diff?path=README.md";
    expect(
      (
        await GET(
          new Request(
            "http://server.test/api/agent-workspaces/workspace/file-diff",
          ),
          context,
        )
      ).status,
    ).toBe(400);

    mocks.supports.mockReturnValueOnce(false);
    const outdated = await GET(new Request(url), context);
    expect(outdated.status).toBe(426);
    expect(mocks.supports).toHaveBeenCalledWith("connector", "workspace-files-v2");

    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), context)).status).toBe(404);
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), context)).status).toBe(401);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
