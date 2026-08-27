import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileAgentWorkspace } from "./agentConnections";

describe("agent workspace setup client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits one atomic workspace reconciliation request", async () => {
    const result = {
      providers: 2,
      created: 2,
      refreshed: 0,
      failures: [],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reconcileAgentWorkspace({
        target: { connectorId: "connector", transport: "local" },
        path: "/srv/overtchat",
        installations: [
          {
            provider: "codex",
            executable: "/usr/local/bin/codex",
            version: "1.2.3",
            shellMode: "interactive",
          },
          {
            provider: "opencode",
            executable: "/usr/local/bin/opencode",
            version: "1.18.23",
            shellMode: "interactive",
          },
        ],
      }),
    ).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-workspaces",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces server reconciliation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ error: "Workspace probe failed." }, { status: 400 }),
        ),
    );

    await expect(
      reconcileAgentWorkspace({
        target: { connectorId: "connector", transport: "local" },
        path: "/srv/overtchat",
      }),
    ).rejects.toThrow("Workspace probe failed.");
  });
});
