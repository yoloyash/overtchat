import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MemoryCapacityError extends Error {}
  return {
    MemoryCapacityError,
    getSession: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    clearMemories: vi.fn(),
  };
});

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/personalization", () => ({
  MemoryCapacityError: mocks.MemoryCapacityError,
  createMemory: mocks.createMemory,
  updateMemory: mocks.updateMemory,
  deleteMemory: mocks.deleteMemory,
  clearMemories: mocks.clearMemories,
}));

import { DELETE as clearAll, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

function request(method: string, body?: unknown) {
  return new Request("http://server.test/api/memories", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

const params = { params: Promise.resolve({ id: "memory" }) };

describe("memories API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect((await PATCH(request("PATCH", {}), params)).status).toBe(401);
    expect((await DELETE(request("DELETE"), params)).status).toBe(401);
  });

  it("normalizes a new key and scopes it to the session user", async () => {
    mocks.createMemory.mockReturnValue({
      id: "memory",
      key: "response_style",
      value: "Prefer concise answers.",
    });
    const response = await POST(
      request("POST", {
        key: "  RESPONSE_STYLE ",
        value: " Prefer concise answers. ",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createMemory).toHaveBeenCalledWith("user", {
      key: "response_style",
      value: "Prefer concise answers.",
    });
  });

  it("reports duplicate keys and capacity errors as conflicts", async () => {
    mocks.createMemory.mockReturnValueOnce("conflict");
    expect(
      (await POST(request("POST", { key: "fact", value: "Value" }))).status,
    ).toBe(409);

    mocks.createMemory.mockImplementationOnce(() => {
      throw new mocks.MemoryCapacityError("Memory is full.");
    });
    const response = await POST(
      request("POST", { key: "another", value: "Value" }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Memory is full." });
  });

  it("updates and deletes only through user-scoped services", async () => {
    mocks.updateMemory.mockReturnValue({
      id: "memory",
      key: "fact",
      value: "Updated",
    });
    const updateResponse = await PATCH(
      request("PATCH", { key: "fact", value: "Updated" }),
      params,
    );
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateMemory).toHaveBeenCalledWith("memory", "user", {
      key: "fact",
      value: "Updated",
    });

    mocks.deleteMemory.mockResolvedValue(true);
    expect((await DELETE(request("DELETE"), params)).status).toBe(204);
    expect(mocks.deleteMemory).toHaveBeenCalledWith("memory", "user");
  });

  it("clears only the authenticated user's memories", async () => {
    expect((await clearAll(request("DELETE"))).status).toBe(204);
    expect(mocks.clearMemories).toHaveBeenCalledWith("user");
  });
});
