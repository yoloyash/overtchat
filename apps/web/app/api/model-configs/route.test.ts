import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createModelConfig: vi.fn(),
  listModelConfigs: vi.fn(),
  toAdminModelConfig: vi.fn((row) => row),
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
    await expect(response.json()).resolves.toMatchObject({
      modelConfigs: [
        {
          id: "text-only",
          contextWindow: 128_000,
          capabilities: { inputModalities: ["text"] },
          toolCallingEnabled: false,
        },
      ],
    });
  });
});
