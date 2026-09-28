import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getModelPreferences: vi.fn(),
  setDefaultModel: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelPreferences", () => mocks);
import { GET, PUT } from "./route";

const request = (body: unknown) =>
  new Request("http://localhost/api/model-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    user: { id: "ordinary-user", role: "user" },
  });
  mocks.getModelPreferences.mockReturnValue({ defaultModelId: "saved" });
  mocks.setDefaultModel.mockReturnValue({ defaultModelId: "chosen" });
});

it("reads and writes only the authenticated user's preference, including non-admins", async () => {
  expect(
    await (
      await GET(
        new Request("http://localhost/api/model-preferences?userId=other"),
      )
    ).json(),
  ).toEqual({ defaultModelId: "saved" });
  expect(mocks.getModelPreferences).toHaveBeenCalledWith("ordinary-user");
  expect((await PUT(request({ defaultModelId: "chosen" }))).status).toBe(200);
  expect(mocks.setDefaultModel).toHaveBeenCalledWith("ordinary-user", "chosen");
});

it("requires a session for reads and writes", async () => {
  mocks.getSession.mockResolvedValue(null);
  expect((await GET(request({}))).status).toBe(401);
  expect((await PUT(request({ defaultModelId: "chosen" }))).status).toBe(401);
  expect(mocks.setDefaultModel).not.toHaveBeenCalled();
});

it.each([
  {},
  { defaultModelId: ["chosen"] },
  { defaultModelId: 42 },
  { defaultModelId: "" },
  { defaultModelId: "chosen", userId: "other" },
])("rejects invalid or foreign-user input: %j", async (body) => {
  expect((await PUT(request(body))).status).toBe(400);
  expect(mocks.setDefaultModel).not.toHaveBeenCalled();
});

it("rejects malformed JSON and unavailable models", async () => {
  expect(
    (
      await PUT(
        new Request("http://localhost/api/model-preferences", {
          method: "PUT",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  mocks.setDefaultModel.mockReturnValue(null);
  expect((await PUT(request({ defaultModelId: "missing" }))).status).toBe(404);
});

it("allows clearing the default", async () => {
  expect((await PUT(request({ defaultModelId: null }))).status).toBe(200);
  expect(mocks.setDefaultModel).toHaveBeenCalledWith("ordinary-user", null);
});
