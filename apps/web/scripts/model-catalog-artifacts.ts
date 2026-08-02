import { createHash } from "node:crypto";

export const MODEL_CATALOG_SCHEMA_VERSION = 1;
export const MODEL_CATALOG_SOURCE_URL = "https://models.dev/api.json";

export interface ModelCatalogManifest {
  schemaVersion: number;
  generatedAt: string;
  sourceUrl: string;
  sourceSha256: string;
  catalogSha256: string;
  modelCount: number;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createModelCatalogManifest({
  catalogText,
  sourceText,
  generatedAt,
  modelCount,
}: {
  catalogText: string;
  sourceText: string;
  generatedAt: string;
  modelCount: number;
}): ModelCatalogManifest {
  return {
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    generatedAt,
    sourceUrl: MODEL_CATALOG_SOURCE_URL,
    sourceSha256: sha256(sourceText),
    catalogSha256: sha256(catalogText),
    modelCount,
  };
}

export function validateModelCatalogArtifacts(
  catalogText: string,
  manifestText: string,
): ModelCatalogManifest {
  const catalog = parseObject(catalogText, "model catalog");
  const manifest = parseObject(
    manifestText,
    "model catalog manifest",
  ) as Partial<ModelCatalogManifest>;
  const errors: string[] = [];

  if (manifest.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${MODEL_CATALOG_SCHEMA_VERSION}`,
    );
  }
  if (
    typeof manifest.generatedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.generatedAt)) ||
    new Date(manifest.generatedAt).toISOString() !== manifest.generatedAt
  ) {
    errors.push("generatedAt must be an ISO 8601 UTC timestamp");
  }
  if (manifest.sourceUrl !== MODEL_CATALOG_SOURCE_URL) {
    errors.push(`sourceUrl must be ${MODEL_CATALOG_SOURCE_URL}`);
  }
  if (!isSha256(manifest.sourceSha256)) {
    errors.push("sourceSha256 must be a SHA-256 digest");
  }

  const catalogSha256 = sha256(catalogText);
  if (manifest.catalogSha256 !== catalogSha256) {
    errors.push("catalogSha256 does not match model-catalog.json");
  }

  const modelCount = Object.values(catalog).reduce<number>(
    (count, models) => {
      if (!isObject(models)) return count;
      return count + Object.keys(models).length;
    },
    0,
  );
  if (manifest.modelCount !== modelCount) {
    errors.push(
      `modelCount is ${String(manifest.modelCount)}, expected ${modelCount}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid model catalog artifacts:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }

  return manifest as ModelCatalogManifest;
}

function parseObject(
  value: string,
  description: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isObject(parsed)) {
    throw new Error(`${description} must contain a JSON object`);
  }
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
