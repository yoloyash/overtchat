import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import { listAgentDirectories } from "./filesystem";

describe("agent directory browsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the connector's canonical directory listing", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({
        path: "/srv/project",
        parent: "/srv",
        directories: [
          { name: "alpha", path: "/srv/project/alpha" },
          { name: "zeta", path: "/srv/project/zeta" },
        ],
      }),
      stderr: "",
    });
    const listing = await listAgentDirectories(
      { transport: "local" },
      "/srv/project",
    );

    expect(listing).toEqual({
      path: "/srv/project",
      parent: "/srv",
      directories: [
        { name: "alpha", path: "/srv/project/alpha" },
        { name: "zeta", path: "/srv/project/zeta" },
      ],
    });
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      { transport: "local" },
      expect.objectContaining({
        command: "node",
        args: expect.arrayContaining(["/srv/project"]),
      }),
    );
  });

  it("rejects malformed connector output", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({ path: "/srv/project", directories: "invalid" }),
      stderr: "",
    });

    await expect(
      listAgentDirectories(
        { transport: "local" },
        "/srv/project",
      ),
    ).rejects.toThrow("invalid directory list");
  });
});
