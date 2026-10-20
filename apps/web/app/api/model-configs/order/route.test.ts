import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  reorderModelConfigs: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  reorderModelConfigs: mocks.reorderModelConfigs,
}));
import { PUT } from "./route";
const request = (body: unknown) =>
  new Request("http://localhost/api/model-configs/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
  mocks.reorderModelConfigs.mockReturnValue(true);
});
it("saves a shared order for administrators", async () => {
  const response = await PUT(request({ modelIds: ["b", "a"] }));
  expect(response.status).toBe(200);
  expect(mocks.reorderModelConfigs).toHaveBeenCalledWith(["b", "a"]);
});
it.each([null, { user: { id: "user", role: "user" } }])(
  "rejects unauthorized sessions: %j",
  async (session) => {
    mocks.getSession.mockResolvedValue(session);
    expect((await PUT(request({ modelIds: ["a"] }))).status).toBe(
      session ? 403 : 401,
    );
    expect(mocks.reorderModelConfigs).not.toHaveBeenCalled();
  },
);
it.each([{}, { modelIds: ["a", "a"] }, { modelIds: [42] }, { modelIds: [""] }])(
  "rejects invalid orders: %j",
  async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.reorderModelConfigs).not.toHaveBeenCalled();
  },
);
it("rejects malformed JSON and stale catalogs", async () => {
  expect(
    (
      await PUT(
        new Request("http://localhost/api/model-configs/order", {
          method: "PUT",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  mocks.reorderModelConfigs.mockReturnValue(false);
  expect((await PUT(request({ modelIds: ["a"] }))).status).toBe(409);
});
