import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  MODEL_CATALOG_SOURCE_URL,
  validateModelCatalogArtifacts,
} from "@/scripts/model-catalog-artifacts";

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
});
