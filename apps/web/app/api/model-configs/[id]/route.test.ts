import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.session } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.get,
  updateModelConfig: mocks.update,
  deleteModelConfig: mocks.remove,
  toAdminModelConfig: (row: unknown) => row,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.create,
}));
import { PATCH } from "./route";
const existing = {
  id: "model",
  label: "Existing",
  providerId: "openai",
  apiFormat: "auto",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "existing-secret",
  model: "gpt-test",
  modelType: "chat",
  pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
  contextWindow: 16000,
  discoveredContextWindow: 32000,
  discoveredCapabilities: { toolCalling: true },
  systemPrompt: "Keep this",
  providerOptions: { openai: { store: false } },
  toolCallingEnabled: true,
  enabled: true,
};
function request(body: unknown) {
  return new Request("http://localhost/api/model-configs/model", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "model" }) };
describe("model updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { role: "admin" } });
    mocks.get.mockResolvedValue(existing);
    mocks.update.mockImplementation((_id, input) => ({
      ...input,
      id: "model",
    }));
  });
  it("retains the existing complete-editor request contract", async () => {
    expect(
      (await PATCH(request({ ...existing, label: "Renamed" }), params)).status,
    ).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      label: "Renamed",
      apiKey: "existing-secret",
    });
  });
  it.each([{ enabled: false }, { enabled: false, label: "incomplete" }, {}])(
    "rejects malformed/incomplete updates",
    async (body) => {
      expect((await PATCH(request(body), params)).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it("keeps an OpenRouter model that an older client saves as custom", async () => {
    const openRouter = {
      ...existing,
      providerId: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      providerOptions: null,
    };
    mocks.get.mockResolvedValue(openRouter);

    const response = await PATCH(
      request({
        ...openRouter,
        providerId: "custom",
        apiFormat: "openai-chat",
        label: "Renamed",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      label: "Renamed",
      providerId: "openrouter",
      apiFormat: "auto",
    });
    // The response still uses the view that client can render.
    await expect(response.json()).resolves.toMatchObject({
      modelConfig: { providerId: "custom", apiFormat: "openai-chat" },
    });
  });

  it("lets a current client change an OpenRouter model to custom", async () => {
    mocks.get.mockResolvedValue({
      ...existing,
      providerId: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
    });

    const response = await PATCH(
      new Request("http://localhost/api/model-configs/model", {
        method: "PATCH",
        headers: { "X-OvertChat-Client": "web" },
        body: JSON.stringify({
          ...existing,
          providerId: "custom",
          apiFormat: "openai-chat",
          baseUrl: "https://openrouter.ai/api/v1",
          providerOptions: null,
        }),
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      providerId: "custom",
      apiFormat: "openai-chat",
    });
  });

  it.each([null, { user: { role: "user" } }])(
    "requires an administrator",
    async (session) => {
      mocks.session.mockResolvedValue(session);
      expect((await PATCH(request({ enabled: false }), params)).status).toBe(
        session ? 403 : 401,
      );
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
});
