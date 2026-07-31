import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listProviderModels: vi.fn(),
  catalogContextWindowFor: vi.fn(),
  catalogCapabilitiesFor: vi.fn(),
  catalogPricingFor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/providers/server/registry", () => ({
  listProviderModels: mocks.listProviderModels,
}));
vi.mock("@/lib/providers/server/model-catalog", () => ({
  catalogContextWindowFor: mocks.catalogContextWindowFor,
  catalogCapabilitiesFor: mocks.catalogCapabilitiesFor,
  catalogPricingFor: mocks.catalogPricingFor,
}));

import { POST } from "./route";

describe("model discovery route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.listProviderModels.mockResolvedValue([
      { id: "runtime-model", contextWindow: 32_768 },
      { id: "catalog-model" },
      { id: "unknown-model" },
    ]);
    mocks.catalogContextWindowFor.mockImplementation(
      (_providerId: string, model: string) =>
        model === "runtime-model"
          ? 65_536
          : model === "catalog-model"
            ? 128_000
            : undefined,
    );
    mocks.catalogCapabilitiesFor.mockImplementation(
      (_providerId: string, model: string) =>
        model === "runtime-model"
          ? { toolCalling: true, inputModalities: ["text", "image"] }
          : model === "catalog-model"
            ? { reasoning: true }
            : undefined,
    );
    mocks.catalogPricingFor.mockImplementation(
      (_providerId: string, model: string) =>
        model === "catalog-model"
          ? {
              input: 2,
              output: 8,
              cacheRead: 0.2,
              cacheWrite: 2.5,
              tiered: true,
            }
          : undefined,
    );
  });

  it("returns runtime limits separately from exact catalog fallbacks", async () => {
    const response = await POST(
      new Request("http://server.test/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "openai",
          apiFormat: "auto",
          baseUrl: "https://api.openai.test/v1",
          apiKey: "secret",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          id: "runtime-model",
          contextWindow: 32_768,
          catalogCapabilities: {
            toolCalling: true,
            inputModalities: ["text", "image"],
          },
          catalogContextWindow: 65_536,
        },
        {
          id: "catalog-model",
          catalogContextWindow: 128_000,
          catalogCapabilities: { reasoning: true },
          catalogPricing: {
            input: 2,
            output: 8,
            cacheRead: 0.2,
            cacheWrite: 2.5,
            tiered: true,
          },
        },
        { id: "unknown-model" },
      ],
    });
  });
});
