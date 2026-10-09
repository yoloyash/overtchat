import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getModelConfig: vi.fn(),
  modelConfigForUser: vi.fn(),
  pingModel: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
  modelConfigForUser: mocks.modelConfigForUser,
}));
vi.mock("@/lib/modelHealth", () => ({ pingModel: mocks.pingModel }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "model-1" }) };
const req = () => new Request("http://server.test/api/model-configs/model-1/health", { method: "POST" });

describe("model health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    mocks.getModelConfig.mockResolvedValue({
      id: "model-1",
      modelType: "chat",
      credentialScope: "user",
      apiKey: "model-own-key",
      baseUrl: "https://model.test/v1",
    });
    mocks.pingModel.mockResolvedValue({ ok: true, elapsedMs: 5 });
  });

  it("tests a per-user model with the administrator's own credential", async () => {
    mocks.modelConfigForUser.mockImplementation((row) => ({ ...row, apiKey: "admin-key" }));

    await expect((await POST(req(), params)).json()).resolves.toMatchObject({ ok: true });
    expect(mocks.modelConfigForUser).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mocks.pingModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "admin-key" }));
  });

  it("asks the administrator for their own credential rather than testing another key", async () => {
    mocks.modelConfigForUser.mockReturnValue(null);

    const json = await (await POST(req(), params)).json();

    expect(json).toMatchObject({ ok: false });
    expect(json.error).toMatch(/your own credential/);
    expect(mocks.pingModel).not.toHaveBeenCalled();
  });
});
