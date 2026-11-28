import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createModelConfigs: vi.fn(),
  toAdminModelConfig: vi.fn((row) => row),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  createModelConfigs: mocks.createModelConfigs,
  toAdminModelConfig: mocks.toAdminModelConfig,
}));

import { POST } from "./route";

const connection = {
  providerId: "bedrock",
  apiFormat: "auto",
  baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
  apiKey: "key",
};

function model(model: string, input: Record<string, unknown> = {}) {
  return { ...connection, label: model, model, ...input };
}

function request(modelConfigs: unknown): Request {
  return new Request("http://server.test/api/model-configs/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OvertChat-Client": "web",
    },
    body: JSON.stringify({ modelConfigs }),
  });
}

describe("adding several models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.createModelConfigs.mockImplementation((inputs: object[]) =>
      inputs.map((input, index) => ({ id: `model-${index}`, ...input })),
    );
  });

  it("saves every model in one call and returns them in order", async () => {
    const response = await POST(
      request([
        model("openai.gpt-5.6-terra", { discoveredContextWindow: 400_000 }),
        model("openai.gpt-5.6-luna"),
      ]),
    );

    expect(response.status).toBe(201);
    expect(mocks.createModelConfigs).toHaveBeenCalledTimes(1);
    expect(mocks.createModelConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        model: "openai.gpt-5.6-terra",
        discoveredContextWindow: 400_000,
      }),
      expect.objectContaining({ model: "openai.gpt-5.6-luna" }),
    ]);
    const json = (await response.json()) as { modelConfigs: { id: string }[] };
    expect(json.modelConfigs.map((item) => item.id)).toEqual([
      "model-0",
      "model-1",
    ]);
  });

  it("saves nothing when one model is not valid for the provider, and names it", async () => {
    const response = await POST(
      request([model("openai.gpt-5.6-terra"), model("future.unknown-model")]),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(
        /^future\.unknown-model: .*Unsupported Bedrock model/,
      ),
    });
    expect(mocks.createModelConfigs).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty list", [], "Choose at least one model"],
    [
      "more models than one add allows",
      Array.from({ length: 101 }, (_, index) => model(`openai.gpt-${index}`)),
      "Add up to 100 models at a time",
    ],
    [
      "an image model",
      [
        model("openai.gpt-5.6-terra"),
        {
          label: "Images",
          modelType: "image",
          providerId: "openai",
          apiFormat: "auto",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "key",
          model: "gpt-image-1",
        },
      ],
      "Only chat models can be added together",
    ],
    [
      "a model without an ID",
      [model("openai.gpt-5.6-terra"), model("", { label: "No ID" })],
      "Model is required",
    ],
  ])("rejects %s", async (_name, modelConfigs, message) => {
    const response = await POST(request(modelConfigs));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(mocks.createModelConfigs).not.toHaveBeenCalled();
  });

  it("is for administrators only", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "bob", role: "user" } });
    expect((await POST(request([model("openai.gpt-5.6-terra")]))).status).toBe(
      403,
    );
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(request([model("openai.gpt-5.6-terra")]))).status).toBe(
      401,
    );
    expect(mocks.createModelConfigs).not.toHaveBeenCalled();
  });
});
