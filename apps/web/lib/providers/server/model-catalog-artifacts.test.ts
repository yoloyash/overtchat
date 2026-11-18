import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_CATALOG_IMAGE_COST_SOURCE_URL,
  MODEL_CATALOG_SOURCE_URL,
  readModelCatalogImageCost,
  validateModelCatalogArtifacts,
} from "./model-catalog-artifacts";

import type { ProviderId } from "@/lib/providers/catalog";
import catalogJson from "./model-catalog.json";
import {
  estimateGenerationCost,
  estimateImageGenerationCost,
} from "./model-cost";

vi.mock("server-only", () => ({}));

const catalogText = readFileSync(
  resolve(process.cwd(), "lib/providers/server/model-catalog.json"),
  "utf8",
);
const manifestText = readFileSync(
  resolve(
    process.cwd(),
    "lib/providers/server/model-catalog.manifest.json",
  ),
  "utf8",
);

describe("model catalog artifacts", () => {
  it("binds the vendored catalog to its generated manifest", () => {
    expect(
      validateModelCatalogArtifacts(catalogText, manifestText),
    ).toMatchObject({
      schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
      sourceUrl: MODEL_CATALOG_SOURCE_URL,
      imageCostSourceUrl: MODEL_CATALOG_IMAGE_COST_SOURCE_URL,
    });
  });

  it("reads per-token image rates from models.dev v2 costs", () => {
    const text = { input: { price: 5 } };
    expect(
      readModelCatalogImageCost({ text, image: { output: { price: 30 } } }),
    ).toEqual({ input: 5, output: 30 });
    expect(
      readModelCatalogImageCost({
        text: { input: { unit: "token", price: 5 } },
        image: { output: { unit: "token", price: 30 } },
      }),
    ).toEqual({ input: 5, output: 30 });
    expect(
      readModelCatalogImageCost({
        text,
        image: { output: { unit: "image", price: 0.04 } },
      }),
    ).toBeUndefined();
    expect(
      readModelCatalogImageCost({ text, image: { input: { price: 8 } } }),
    ).toBeUndefined();
  });

  it("prices image generation for every model with image rates", () => {
    const imageModels = Object.entries(catalogJson).flatMap(
      ([providerId, models]) =>
        Object.entries(models)
          .filter(([, entry]) => "image_cost" in entry)
          .map(([model]) => ({ providerId: providerId as ProviderId, model })),
    );

    expect(imageModels.length).toBeGreaterThan(0);
    for (const { providerId, model } of imageModels) {
      expect(
        estimateImageGenerationCost({
          providerId,
          model,
          usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 },
        }),
        `${providerId}/${model}`,
      ).not.toBeNull();
    }
  });

  it("rejects catalog changes without a matching manifest", () => {
    expect(() =>
      validateModelCatalogArtifacts(`${catalogText}\n`, manifestText),
    ).toThrow("catalogSha256 does not match");
  });

  it("rejects invalid generation timestamps", () => {
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    manifest.generatedAt = "recently";

    expect(() =>
      validateModelCatalogArtifacts(
        catalogText,
        JSON.stringify(manifest),
      ),
    ).toThrow("generatedAt must be an ISO 8601 UTC timestamp");
  });

  it("supports every priced text model in the vendored catalog", () => {
    for (const [providerId, models] of Object.entries(catalogJson)) {
      for (const [model, entry] of Object.entries(models)) {
        if (!("cost" in entry) || !entry.cost) continue;

        expect(
          estimateGenerationCost({
            providerId: providerId as ProviderId,
            model,
            usage: {
              inputTokens: 300_001,
              outputTokens: 100,
              totalTokens: 300_101,
              inputTokenDetails: {
                noCacheTokens: 100_001,
                cacheReadTokens: 100_000,
                cacheWriteTokens: 100_000,
              },
              outputTokenDetails: {
                textTokens: 100,
                reasoningTokens: undefined,
              },
            },
          }),
          `${providerId}/${model}`,
        ).not.toBeNull();
      }
    }
  });
});
