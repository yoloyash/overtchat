import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelsForProvider } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const connection = {
  providerId: "custom" as const,
  apiFormat: "openai-chat" as const,
  baseUrl: "http://localhost:8000/v1",
  apiKey: null,
};

describe("model discovery client", () => {
  it("parses model IDs and optional context windows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          models: [
            {
              id: "known",
              contextWindow: 131_072,
              capabilities: {
                toolCalling: true,
                inputModalities: ["text", "image", "image", ""],
                maxOutputTokens: 8192,
              },
            },
            {
              id: "catalog-only",
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
            { id: "unknown" },
          ],
        }),
      ),
    );

    await expect(fetchModelsForProvider(connection)).resolves.toEqual([
      {
        id: "known",
        contextWindow: 131_072,
        capabilities: {
          toolCalling: true,
          inputModalities: ["text", "image"],
          maxOutputTokens: 8192,
        },
      },
      {
        id: "catalog-only",
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
      { id: "unknown" },
    ]);
  });

  it("ignores malformed discovery entries and invalid limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          models: [
            null,
            "legacy-string",
            { id: "" },
            { id: "negative", contextWindow: -1 },
            { id: "fractional", contextWindow: 1.5 },
            {
              id: "bad-pricing",
              catalogPricing: {
                input: 2,
                output: -1,
                cacheRead: 0.2,
                cacheWrite: 2.5,
                tiered: false,
              },
            },
          ],
        }),
      ),
    );

    await expect(fetchModelsForProvider(connection)).resolves.toEqual([
      { id: "negative" },
      { id: "fractional" },
      { id: "bad-pricing" },
    ]);
  });
});
