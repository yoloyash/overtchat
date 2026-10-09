import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getModelConfig: vi.fn(),
  getModelUserCredential: vi.fn(),
  setModelUserCredential: vi.fn(),
  deleteModelUserCredential: vi.fn(),
  userExists: vi.fn(),
  createConfiguredLanguageModel: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
  getModelUserCredential: mocks.getModelUserCredential,
  setModelUserCredential: mocks.setModelUserCredential,
  deleteModelUserCredential: mocks.deleteModelUserCredential,
}));
vi.mock("@/lib/db/users", () => ({ userExists: mocks.userExists }));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createConfiguredLanguageModel,
}));

import { DELETE, PUT } from "./route";

const params = { params: Promise.resolve({ id: "model-1", userId: "alice" }) };
const perUserModel = {
  id: "model-1",
  providerId: "openai",
  apiFormat: "auto",
  baseUrl: "https://api.openai.com/v1",
  apiKey: null,
  model: "gpt-5.6",
  credentialScope: "user",
};

function put(body: unknown) {
  return new Request("http://server.test/api/model-configs/model-1/credentials/alice", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("per-user credential writes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    mocks.getModelConfig.mockResolvedValue({ ...perUserModel });
    mocks.userExists.mockReturnValue(true);
    mocks.getModelUserCredential.mockReturnValue(null);
    mocks.setModelUserCredential.mockImplementation((_id, userId, input) => ({
      userId,
      hasApiKey: !!input.apiKey,
      baseUrl: input.baseUrl,
      updatedAt: 1,
    }));
  });

  it("is admin-only", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "alice", role: "user" } });
    expect((await PUT(put({ apiKey: "k" }), params)).status).toBe(403);
    expect((await DELETE(put({}), params)).status).toBe(403);
    expect(mocks.setModelUserCredential).not.toHaveBeenCalled();
    expect(mocks.deleteModelUserCredential).not.toHaveBeenCalled();
  });

  it("stores the key without ever returning it", async () => {
    const response = await PUT(put({ apiKey: " alice-key ", baseUrl: "https://alice.test/v1/" }), params);

    expect(response.status).toBe(200);
    expect(mocks.setModelUserCredential).toHaveBeenCalledWith("model-1", "alice", {
      apiKey: "alice-key",
      baseUrl: "https://alice.test/v1",
    });
    const text = await response.text();
    expect(text).not.toContain("alice-key");
    expect(JSON.parse(text)).toMatchObject({ credential: { hasApiKey: true } });
  });

  it("validates the effective connection, keeping the stored key when the key is omitted", async () => {
    mocks.getModelUserCredential.mockReturnValue({ apiKey: "stored-key", baseUrl: null });

    expect((await PUT(put({ baseUrl: null }), params)).status).toBe(200);
    expect(mocks.createConfiguredLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "stored-key", baseUrl: perUserModel.baseUrl }),
    );
    expect(mocks.setModelUserCredential).toHaveBeenCalledWith("model-1", "alice", { baseUrl: null });
  });

  it("rejects a credential the provider would refuse", async () => {
    const { ProviderConfigurationError } = await import("@/lib/providers/server/errors");
    mocks.createConfiguredLanguageModel.mockImplementation(() => {
      throw new ProviderConfigurationError("OpenAI requires an API key.");
    });

    const response = await PUT(put({ apiKey: null }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "OpenAI requires an API key." });
    expect(mocks.setModelUserCredential).not.toHaveBeenCalled();
  });

  it("refuses shared models, unknown models, and unknown users", async () => {
    mocks.getModelConfig.mockResolvedValueOnce({ ...perUserModel, credentialScope: "shared" });
    expect((await PUT(put({ apiKey: "k" }), params)).status).toBe(400);
    mocks.getModelConfig.mockResolvedValueOnce(null);
    expect((await PUT(put({ apiKey: "k" }), params)).status).toBe(404);
    mocks.userExists.mockReturnValueOnce(false);
    expect((await PUT(put({ apiKey: "k" }), params)).status).toBe(404);
    expect(mocks.setModelUserCredential).not.toHaveBeenCalled();
  });

  it("deletes a credential, and reports a missing one", async () => {
    mocks.deleteModelUserCredential.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect((await DELETE(put({}), params)).status).toBe(204);
    expect((await DELETE(put({}), params)).status).toBe(404);
    expect(mocks.deleteModelUserCredential).toHaveBeenCalledWith("model-1", "alice");
  });
});
