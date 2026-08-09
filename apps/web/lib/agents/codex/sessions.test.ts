import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  startCodexAppServer: vi.fn(),
}));

vi.mock("./app-server", () => ({
  startCodexAppServer: mocks.startCodexAppServer,
}));

import { listCodexWorkspaceSessions } from "./sessions";

function thread(id: string, cwd: string, updatedAt: number) {
  return {
    id,
    cwd,
    preview: `Prompt ${id}`,
    path: `/sessions/${id}.jsonl`,
    name: null,
    createdAt: updatedAt - 10,
    updatedAt,
    turns: [],
  };
}

describe("Codex workspace session discovery", () => {
  const server = {
    ready: vi.fn(async () => {}),
    request: vi.fn(),
    stop: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startCodexAppServer.mockReturnValue(server);
  });

  it("paginates native threads and keeps the exact workspace", async () => {
    server.request
      .mockResolvedValueOnce({
        data: [
          thread("thread-1", "/workspace", 20),
          thread("other", "/other", 30),
        ],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        data: [thread("thread-2", "/workspace", 10)],
        nextCursor: null,
      });

    await expect(
      listCodexWorkspaceSessions(
        { connectorId: "connector", transport: "local" },
        "/opt/bin/codex",
        "/workspace",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        providerSessionId: "thread-1",
        firstMessage: "Prompt thread-1",
      }),
      expect.objectContaining({
        providerSessionId: "thread-2",
        firstMessage: "Prompt thread-2",
      }),
    ]);
    expect(server.request).toHaveBeenNthCalledWith(1, "thread/list", {
      cwd: "/workspace",
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
    expect(server.request).toHaveBeenNthCalledWith(2, "thread/list", {
      cwd: "/workspace",
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      cursor: "next",
    });
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it("rejects repeated cursors and still stops app-server", async () => {
    server.request.mockResolvedValue({
      data: [],
      nextCursor: "same",
    });

    await expect(
      listCodexWorkspaceSessions(
        { connectorId: "connector", transport: "local" },
        "codex",
        "/workspace",
      ),
    ).rejects.toThrow("Codex repeated a thread-list cursor");
    expect(server.stop).toHaveBeenCalledOnce();
  });
});
