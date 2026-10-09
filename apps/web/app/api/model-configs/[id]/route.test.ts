import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getModelConfig: vi.fn(),
  updateModelConfig: vi.fn(),
  deleteModelConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
  updateModelConfig: mocks.updateModelConfig,
  deleteModelConfig: mocks.deleteModelConfig,
  toAdminModelConfig: (row: unknown) => row,
}));

import { PATCH } from "./route";

const params = { params: Promise.resolve({ id: "model-1" }) };
const body = {
  label: "Assistant",
  providerId: "openai",
  apiFormat: "auto",
  baseUrl: "https://api.openai.com/v1",
  apiKey: null,
  model: "gpt-5.6",
  enabled: false,
};

function patch(input: Record<string, unknown>) {
  return new Request("http://server.test/api/model-configs/model-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

describe("model config updates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    mocks.getModelConfig.mockResolvedValue({ id: "model-1", credentialScope: "user" });
    mocks.updateModelConfig.mockImplementation(async (id, input) => ({ id, ...input }));
  });

  it("keeps a per-user model per-user when a client omits the scope", async () => {
    // e.g. the models list's enable toggle, or a client that predates the field
    // PATCH's return type includes the admin guard's optional error.
    const response = (await PATCH(patch(body), params))!;

    expect(response.status).toBe(200);
    expect(mocks.updateModelConfig).toHaveBeenCalledWith(
      "model-1",
      expect.objectContaining({ credentialScope: "user", enabled: false }),
    );
  });

  it("changes the scope when a client sends one", async () => {
    const response = (await PATCH(patch({ ...body, apiKey: "k", credentialScope: "shared" }), params))!;

    expect(response.status).toBe(200);
    expect(mocks.updateModelConfig).toHaveBeenCalledWith(
      "model-1",
      expect.objectContaining({ credentialScope: "shared" }),
    );
  });
});
