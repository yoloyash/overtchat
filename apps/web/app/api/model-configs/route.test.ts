import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createModelConfig: vi.fn(),
  listModelConfigs: vi.fn(),
  toAdminModelConfig: vi.fn((row) => row),
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

import { POST } from "./route";

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
