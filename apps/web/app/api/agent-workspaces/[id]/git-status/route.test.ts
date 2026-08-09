import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  targetForStoredHost: vi.fn(),
  inspectAgentWorkspaceGitStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
}));
vi.mock("@/lib/agents/runtime/target", () => ({
  targetForStoredHost: mocks.targetForStoredHost,
}));
vi.mock("@/lib/agents/runtime/git", () => ({
  inspectAgentWorkspaceGitStatus: mocks.inspectAgentWorkspaceGitStatus,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };
const request = new Request(
  "http://server.test/api/agent-workspaces/workspace/git-status",
);

describe("agent workspace Git status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: { transport: "local", userId: "owner" },
      connection: { id: "connection", shellMode: "interactive" },
      workspace: {
        id: "workspace",
        path: "/srv/project",
      },
    });
    mocks.targetForStoredHost.mockReturnValue({
      connectorId: "connector",
      transport: "local",
    });
    mocks.inspectAgentWorkspaceGitStatus.mockResolvedValue({
      isGit: true,
      repositoryRoot: "/srv/project",
      branch: "feature/status",
      upstream: "origin/feature/status",
      ahead: 1,
      behind: 0,
      dirty: true,
      changedFiles: 2,
      additions: 8,
      deletions: 3,
      lineStatsComplete: true,
    });
  });

  it("returns fresh Git metadata through the owner-scoped stored host", async () => {
    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.targetForStoredHost).toHaveBeenCalled();
    expect(mocks.inspectAgentWorkspaceGitStatus).toHaveBeenCalledWith(
      { connectorId: "connector", transport: "local" },
      "/srv/project",
    );
    await expect(response.json()).resolves.toMatchObject({
      status: {
        branch: "feature/status",
        changedFiles: 2,
      },
    });
  });

  it("blocks unauthenticated, non-admin, and cross-user access", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(401);

    mocks.getSession.mockResolvedValueOnce({
      user: { id: "owner", role: "user" },
    });
    expect((await GET(request, context)).status).toBe(403);

    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(404);
    expect(mocks.inspectAgentWorkspaceGitStatus).not.toHaveBeenCalled();
  });

  it("returns a useful connector error without caching it", async () => {
    mocks.inspectAgentWorkspaceGitStatus.mockRejectedValue(
      new Error("Git is not installed on the selected machine."),
    );

    const response = await GET(request, context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Git is not installed on the selected machine.",
    });
  });
});
