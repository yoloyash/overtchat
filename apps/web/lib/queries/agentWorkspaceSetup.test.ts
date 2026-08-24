import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import {
  createAgentWorkspaceSetup,
  reconcileAllAgentWorkspaces,
  reconcileAgentWorkspace,
} from "./agentConnections";

const draft = {
  connectorId: "connector",
  provider: "codex" as const,
  transport: "local" as const,
  name: "This server",
  executable: "/usr/local/bin/codex",
};

const connection: AgentConnectionListItem = {
  id: "connection",
  provider: "codex",
  executable: "/usr/local/bin/codex",
  detectedVersion: "1.2.3",
  lastValidatedAt: 1,
  host: {
    id: "host",
    connectorId: "connector",
    name: "This server",
    transport: "local",
    sshAlias: null,
  },
  workspaces: [],
};

const workspace = {
  id: "workspace",
  path: "/srv/overtchat",
  name: "overtchat",
  sessions: [],
};

describe("consolidated agent workspace setup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reuses an existing agent connection and only attaches the folder", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ workspace }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAgentWorkspaceSetup({
        draft,
        path: workspace.path,
        connection,
      }),
    ).resolves.toEqual({ connection, workspace });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-connections/connection/workspaces",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates the agent connection and workspace as one user operation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connection }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ workspace }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAgentWorkspaceSetup({ draft, path: workspace.path }),
    ).resolves.toEqual({ connection, workspace });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes a newly-created connection when attaching the folder fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connection }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({ error: "Folder is unavailable." }, { status: 400 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAgentWorkspaceSetup({ draft, path: workspace.path }),
    ).rejects.toThrow("Folder is unavailable.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent-connections/connection",
      { method: "DELETE" },
    );
  });

  it("creates and imports the directory for every detected provider", async () => {
    const codexConnection = connection;
    const ompConnection = {
      ...connection,
      id: "omp-connection",
      provider: "omp" as const,
      executable: "/usr/local/bin/omp",
    };
    const codexWorkspace = workspace;
    const ompWorkspace = { ...workspace, id: "omp-workspace" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ connection: codexConnection }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({ workspace: codexWorkspace }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({ connection: ompConnection }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({ workspace: ompWorkspace }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reconcileAgentWorkspace({
        target: { connectorId: "connector", transport: "local" },
        path: workspace.path,
        connections: [],
        installations: [
          {
            provider: "codex",
            executable: "/usr/local/bin/codex",
            version: "1.2.3",
          },
          {
            provider: "omp",
            executable: "/usr/local/bin/omp",
            version: "2.0.0",
          },
        ],
      }),
    ).resolves.toEqual({
      providers: 2,
      refreshed: 0,
      created: 2,
      failures: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent-connections",
      expect.objectContaining({
        body: JSON.stringify({
          connectorId: "connector",
          provider: "codex",
          transport: "local",
          name: "This server",
          executable: "/usr/local/bin/codex",
        }),
      }),
    );
  });

  it("refreshes every configured provider already attached to the directory", async () => {
    const attached = {
      ...connection,
      workspaces: [workspace],
    };
    const ompWorkspace = { ...workspace, id: "omp-workspace" };
    const ompConnection: AgentConnectionListItem = {
      ...connection,
      id: "omp-connection",
      provider: "omp",
      executable: "omp",
      workspaces: [ompWorkspace],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reconcileAgentWorkspace({
        target: { connectorId: "connector", transport: "local" },
        path: workspace.path,
        connections: [attached, ompConnection],
        installations: [],
      }),
    ).resolves.toEqual({
      providers: 2,
      refreshed: 2,
      created: 0,
      failures: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-workspaces/workspace",
      { method: "POST" },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-workspaces/omp-workspace",
      { method: "POST" },
    );
  });

  it("global refresh discovers and attaches a newly available provider", async () => {
    const attached = { ...connection, workspaces: [workspace] };
    const ompConnection: AgentConnectionListItem = {
      ...connection,
      id: "omp-connection",
      provider: "omp",
      executable: "omp",
      workspaces: [],
    };
    const ompWorkspace = { ...workspace, id: "omp-workspace" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          installations: [
            {
              provider: "codex",
              executable: "codex",
              version: "1.2.3",
            },
            { provider: "omp", executable: "omp", version: "2.0.0" },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ connection: ompConnection }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({ workspace: ompWorkspace }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          connections: [
            attached,
            { ...ompConnection, workspaces: [ompWorkspace] },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileAllAgentWorkspaces([attached])).resolves.toEqual({
      providers: 2,
      refreshed: 1,
      created: 1,
      failures: [],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent-connections/discover",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/agent-connections",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
