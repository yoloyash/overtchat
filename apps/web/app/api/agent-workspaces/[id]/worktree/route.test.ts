import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  listOwnedAgentWorkspaceFolderRows: vi.fn(),
  deleteAgentWorkspace: vi.fn(),
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
  listOwnedAgentWorkspaceFolderRows: mocks.listOwnedAgentWorkspaceFolderRows,
  deleteAgentWorkspace: mocks.deleteAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    request: mocks.daemonRequest,
    isOnline: mocks.isOnline,
    supports: mocks.supports,
  },
}));

import { DELETE, GET } from "./route";

const context = { params: Promise.resolve({ id: "codex-row" }) };
const url = "http://server.test/api/agent-workspaces/codex-row/worktree";
const target = { transport: "local", shellMode: "interactive" };
const owned = {
  host: { connectorId: "connector", transport: "local", sshAlias: null, userId: "owner" },
  connection: { id: "connection", shellMode: "interactive" },
  workspace: { id: "codex-row", path: "/wt/topic", worktreeParentPath: "/srv/project" },
};

describe("agent workspace worktree route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
    mocks.getOwnedAgentWorkspace.mockResolvedValue(owned);
    mocks.listOwnedAgentWorkspaceFolderRows.mockResolvedValue([
      owned,
      { ...owned, workspace: { ...owned.workspace, id: "claude-row" } },
    ]);
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
  });

  it("reports uncommitted changes the removal would discard", async () => {
    const inspection = { exists: true, worktreePath: "/wt/topic", branch: "topic", changedFiles: 3 };
    mocks.daemonRequest.mockResolvedValueOnce(inspection);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ inspection });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "inspect_git_worktree",
      target,
      path: "/wt/topic",
    });
  });

  it("stops every agent in the folder, deletes the worktree, then removes the workspaces", async () => {
    const calls: string[] = [];
    mocks.daemonRequest.mockImplementation(async (_connector, request: { type: string; workspaceId?: string }) => {
      calls.push(request.workspaceId ? `${request.type}:${request.workspaceId}` : request.type);
      return request.type === "remove_git_worktree" ? { removed: true } : { stopped: true };
    });
    mocks.deleteAgentWorkspace.mockImplementation(async (id: string) => {
      calls.push(`delete:${id}`);
      return true;
    });

    const response = await DELETE(new Request(url, { method: "DELETE" }), context);

    expect(response.status).toBe(204);
    expect(calls).toEqual([
      "stop_workspace:codex-row",
      "stop_workspace:claude-row",
      "remove_git_worktree",
      "delete:codex-row",
      "delete:claude-row",
    ]);
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "remove_git_worktree",
      target,
      path: "/wt/topic",
    });
  });

  it("keeps the workspaces when the host cannot delete the worktree", async () => {
    mocks.daemonRequest.mockImplementation(async (_connector, request: { type: string }) => {
      if (request.type === "remove_git_worktree") {
        throw new Error("OvertChat only deletes worktrees it created.");
      }
      return { stopped: true };
    });
    const response = await DELETE(new Request(url, { method: "DELETE" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "OvertChat only deletes worktrees it created.",
    });
    expect(mocks.deleteAgentWorkspace).not.toHaveBeenCalled();
  });

  it("refuses workspaces that are not OvertChat worktrees", async () => {
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      ...owned,
      workspace: { ...owned.workspace, worktreeParentPath: null },
    });
    expect((await GET(new Request(url), context)).status).toBe(400);
    expect((await DELETE(new Request(url, { method: "DELETE" }), context)).status).toBe(400);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
    expect(mocks.deleteAgentWorkspace).not.toHaveBeenCalled();
  });

  it("asks for a connector update and hides other users' workspaces", async () => {
    mocks.supports.mockReturnValueOnce(false);
    expect((await DELETE(new Request(url, { method: "DELETE" }), context)).status).toBe(426);
    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect((await DELETE(new Request(url, { method: "DELETE" }), context)).status).toBe(404);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
