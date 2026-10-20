import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_CATALOG_SOURCE_URL,
  validateModelCatalogArtifacts,
} from "./model-catalog-artifacts";

import type { ProviderId } from "@/lib/providers/catalog";
import catalogJson from "./model-catalog.json";
import { estimateGenerationCost } from "./model-cost";

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
    });
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
