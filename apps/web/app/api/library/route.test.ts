import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), listLibrary: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/library", () => ({ listLibrary: mocks.listLibrary }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "alice" } });
  mocks.listLibrary.mockResolvedValue({ items: [], nextCursor: null });
});

describe("library API", () => {
  it("requires authentication before querying", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/library"))).status).toBe(401);
    expect(mocks.listLibrary).not.toHaveBeenCalled();
  });

  it("uses the session owner, validates pagination, and prevents shared caching", async () => {
    const cursor = { createdAt: 1000, id: "file-05" };
    const params = new URLSearchParams({ q: "report", cursor: JSON.stringify(cursor), userId: "bob" });
    const response = await GET(new Request(`http://localhost/api/library?${params}`));
    expect(response.status).toBe(200);
    expect(mocks.listLibrary).toHaveBeenCalledWith("alice", "report", cursor);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    "cursor=abc", "cursor=null", "cursor={}",
    ...[
      { createdAt: -1, id: "file" }, { createdAt: 1.5, id: "file" },
      { createdAt: "1000", id: "file" }, { createdAt: 1e20, id: "file" },
      { createdAt: 1000, id: "" }, { createdAt: 1000, id: "a".repeat(201) },
    ].map((cursor) => `cursor=${encodeURIComponent(JSON.stringify(cursor))}`),
    `q=${"a".repeat(201)}`,
  ])("rejects invalid parameters: %s", async (params) => {
    expect((await GET(new Request(`http://localhost/api/library?${params}`))).status).toBe(400);
    expect(mocks.listLibrary).not.toHaveBeenCalled();
  });
});
