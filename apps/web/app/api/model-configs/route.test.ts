import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createModelConfig: vi.fn(),
  listModelConfigs: vi.fn(),
  toAdminModelConfig: vi.fn((row) => row),
  listCredentialedModelIds: vi.fn(() => new Set<string>()),
  resolveModelContextWindow: vi.fn(),
  resolveModelCapabilities: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  createModelConfig: mocks.createModelConfig,
  listModelConfigs: mocks.listModelConfigs,
  toAdminModelConfig: mocks.toAdminModelConfig,
  listCredentialedModelIds: mocks.listCredentialedModelIds,
  isModelAvailableToUser: (
    row: { id: string; credentialScope?: string },
    credentialed: Set<string>,
  ) => row.credentialScope !== "user" || credentialed.has(row.id),
}));
vi.mock("@/lib/providers/server/model-catalog", () => ({
  resolveModelContextWindow: mocks.resolveModelContextWindow,
  resolveModelCapabilities: mocks.resolveModelCapabilities,
}));

import { GET, POST } from "./route";

function request(input: Record<string, unknown>): Request {
  return new Request("http://server.test/api/model-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "Bedrock test",
      providerId: "bedrock",
      apiFormat: "auto",
      baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
      apiKey: "key",
      model: "openai.gpt-5.6-terra",
      pricing: null,
      providerOptions: null,
      systemPrompt: null,
      enabled: true,
      sortOrder: 0,
      ...input,
    }),
  });
}

describe("model config save validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveModelContextWindow.mockReturnValue(128_000);
    mocks.resolveModelCapabilities.mockReturnValue({
      inputModalities: ["text"],
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
  });

  it.each([
    [
      "an unsupported Bedrock model family",
      { model: "future.unknown-model" },
      "Unsupported Bedrock model",
    ],
    [
      "a Bedrock endpoint without the Mantle root",
      { baseUrl: "https://bedrock-mantle.us-east-1.api.aws" },
      "must end with /v1",
    ],
  ])("rejects %s before persistence", async (_name, input, message) => {
    const response = await POST(request(input));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(message),
    });
    expect(mocks.createModelConfig).not.toHaveBeenCalled();
  });

  it("persists administrator pricing overrides", async () => {
    const pricing = {
      input: 2,
      output: 8,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    };
    mocks.createModelConfig.mockImplementation(async (input) => ({
      id: "configured-model",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    }));

    const response = await POST(request({ pricing }));

    expect(response.status).toBe(201);
    expect(mocks.createModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ pricing }),
    );
  });
});

describe("per-user models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveModelContextWindow.mockReturnValue(128_000);
    mocks.resolveModelCapabilities.mockReturnValue({ inputModalities: ["text"] });
  });

  it("saves a per-user model without a key of its own, and never stores the validation placeholder", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
    mocks.createModelConfig.mockImplementation(async (input) => ({ id: "m", ...input }));

    const response = await POST(
      request({
        providerId: "openai",
        apiFormat: "auto",
        baseUrl: "https://api.openai.com/v1",
        apiKey: null,
        model: "gpt-5.6",
        credentialScope: "user",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ credentialScope: "user", apiKey: null }),
    );
  });

  it("lists a per-user model only to users with their own credential", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "alice", role: "user" } });
    const row = (id: string, credentialScope: string) => ({
      id,
      label: id,
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "http://localhost:8000/v1",
      apiKey: null,
      model: id,
      enabled: true,
      modelType: "chat",
      credentialScope,
      toolCallingEnabled: true,
      providerOptions: null,
    });
    mocks.listModelConfigs.mockResolvedValue([
      row("shared", "shared"),
      row("mine", "user"),
      row("someone-elses", "user"),
    ]);
    mocks.listCredentialedModelIds.mockReturnValue(new Set(["mine"]));

    const response = await GET(new Request("http://server.test/api/model-configs"));
    const json = (await response.json()) as { modelConfigs: { id: string }[] };

    expect(mocks.listCredentialedModelIds).toHaveBeenCalledWith("alice");
    expect(json.modelConfigs.map((m) => m.id)).toEqual(["shared", "mine"]);
  });
});

describe("public model configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveModelContextWindow.mockReturnValue(128_000);
    mocks.resolveModelCapabilities.mockReturnValue({
      inputModalities: ["text"],
    });
    mocks.getSession.mockResolvedValue({
      user: { id: "user", role: "user" },
    });
  });

  it("exposes whether the selected model supports tool calling", async () => {
    mocks.listModelConfigs.mockResolvedValue([
      {
        id: "text-only",
        label: "Text only",
        providerId: "custom",
        apiFormat: "openai-chat",
        baseUrl: "http://localhost:8000/v1",
        apiKey: null,
        model: "text-only",
        pricing: {
          input: 2,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: null,
        discoveredContextWindow: null,
        discoveredCapabilities: null,
        systemPrompt: null,
        providerOptions: null,
        toolCallingEnabled: false,
        enabled: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const response = await GET(
      new Request("http://server.test/api/model-configs"),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveModelContextWindow).toHaveBeenCalledWith(
      null,
      null,
      "custom",
      "text-only",
    );
    expect(mocks.resolveModelCapabilities).toHaveBeenCalledWith(
      null,
      "custom",
      "text-only",
    );
    const body = await response.json();
    expect(body).toMatchObject({
      modelConfigs: [
        {
          id: "text-only",
          contextWindow: 128_000,
          capabilities: { inputModalities: ["text"] },
          toolCallingEnabled: false,
        },
      ],
    });
    expect(body.modelConfigs[0]).not.toHaveProperty("pricing");
  });
});
