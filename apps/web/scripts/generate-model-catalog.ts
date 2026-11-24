/**
 * Generates the server-side model metadata and pricing catalog. Runtime
 * discovery can override capabilities, while exact catalog pricing remains
 * the default for cost estimates without a model-config override.
 *
 * The output is committed so self-hosted and air-gapped deployments never
 * depend on models.dev at runtime. A sidecar manifest binds the generated
 * output to the exact upstream payload used to create it.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { ModelReasoningControls } from "@overtchat/shared";
import {
  createModelCatalogManifest,
  MODEL_CATALOG_IMAGE_COST_SOURCE_URL,
  MODEL_CATALOG_SOURCE_URL,
  type ModelCatalogImageCost,
  readModelCatalogImageCost,
  validateModelCatalogArtifacts,
} from "../lib/providers/server/model-catalog-artifacts";
import { catalogReasoningControlsFor } from "../lib/providers/server/model-catalog-reasoning";

const PROVIDERS = [
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["google", "google"],
  ["deepseek", "deepseek"],
  ["bedrock", "amazon-bedrock"],
] as const;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface CatalogEntry {
  context?: number;
  input?: number;
  output?: number;
  cost?: { [key: string]: JsonValue };
  image_cost?: ModelCatalogImageCost;
  input_modalities?: string[];
  output_modalities?: string[];
  attachment?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  reasoning_controls?: ModelReasoningControls;
  structured_output?: boolean;
  temperature?: boolean;
}

async function main() {
  const outputPath = resolve(
    process.cwd(),
    "lib/providers/server/model-catalog.json",
  );
  const manifestPath = resolve(
    process.cwd(),
    "lib/providers/server/model-catalog.manifest.json",
  );

  const { text: sourceText, providers: upstream } = await fetchProviders(
    MODEL_CATALOG_SOURCE_URL,
  );
  const { text: imageCostSourceText, providers: imageCostUpstream } =
    await fetchProviders(MODEL_CATALOG_IMAGE_COST_SOURCE_URL);

  const output: Record<string, Record<string, CatalogEntry>> = {};
  let imageCostCount = 0;

  for (const [providerId, sourceProviderId] of PROVIDERS) {
    const sourceProvider = upstream[sourceProviderId];
    if (!isRecord(sourceProvider) || !isRecord(sourceProvider.models)) {
      throw new Error(`models.dev provider "${sourceProviderId}" has no models`);
    }
    const imageCostProvider = imageCostUpstream[sourceProviderId];
    if (!isRecord(imageCostProvider) || !isRecord(imageCostProvider.models)) {
      throw new Error(
        `models.dev v2 provider "${sourceProviderId}" has no models`,
      );
    }

    const models: Record<string, CatalogEntry> = {};
    const sourceModels = Object.entries(sourceProvider.models).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );

    for (const [sourceKey, sourceModel] of sourceModels) {
      if (!isRecord(sourceModel)) {
        throw new Error(
          `models.dev entry "${sourceProviderId}/${sourceKey}" is not an object`,
        );
      }

      const id = sourceModel.id;
      if (typeof id !== "string" || !id) {
        throw new Error(
          `models.dev entry "${sourceProviderId}/${sourceKey}" has no model ID`,
        );
      }

      const entry: CatalogEntry = {};
      const limit = isRecord(sourceModel.limit) ? sourceModel.limit : undefined;
      const context = readPositiveInteger(limit?.context);
      const modelInput = readPositiveInteger(limit?.input);
      const modelOutput = readPositiveInteger(limit?.output);
      if (context !== undefined) entry.context = context;
      if (modelInput !== undefined) entry.input = modelInput;
      if (modelOutput !== undefined) entry.output = modelOutput;

      if (isRecord(sourceModel.cost)) {
        entry.cost = copyJsonObject(sourceModel.cost);
      }

      const imageCostModel = imageCostProvider.models[sourceKey];
      const imageCost = isRecord(imageCostModel)
        ? readModelCatalogImageCost(imageCostModel.cost)
        : undefined;
      if (imageCost) {
        entry.image_cost = imageCost;
        imageCostCount += 1;
      }

      const modalities = isRecord(sourceModel.modalities)
        ? sourceModel.modalities
        : undefined;
      if (Array.isArray(modalities?.input)) {
        entry.input_modalities = modalities.input.filter(
          (value): value is string => typeof value === "string",
        );
      }
      if (Array.isArray(modalities?.output)) {
        entry.output_modalities = modalities.output.filter(
          (value): value is string => typeof value === "string",
        );
      }

      copyBoolean(sourceModel, entry, "attachment");
      copyBoolean(sourceModel, entry, "tool_call");
      copyBoolean(sourceModel, entry, "reasoning");
      copyBoolean(sourceModel, entry, "structured_output");
      copyBoolean(sourceModel, entry, "temperature");

      if (sourceModel.reasoning === true) {
        const reasoningControls = catalogReasoningControlsFor(
          providerId,
          sourceModel.reasoning_options,
        );
        if (reasoningControls) entry.reasoning_controls = reasoningControls;
      }

      if (models[id]) {
        throw new Error(`Duplicate models.dev model ID "${providerId}/${id}"`);
      }
      models[id] = entry;
    }

    output[providerId] = models;
  }

  if (imageCostCount === 0) {
    throw new Error(
      `${MODEL_CATALOG_IMAGE_COST_SOURCE_URL} returned no image generation rates`,
    );
  }

  const catalogText = `${JSON.stringify(output, null, 2)}\n`;
  const modelCount = Object.values(output).reduce(
    (count, models) => count + Object.keys(models).length,
    0,
  );
  if (
    existsSync(outputPath) &&
    existsSync(manifestPath) &&
    readFileSync(outputPath, "utf8") === catalogText
  ) {
    try {
      const manifestText = readFileSync(manifestPath, "utf8");
      validateModelCatalogArtifacts(catalogText, manifestText);
      console.log(`model catalog is current (${modelCount} models)`);
      return;
    } catch {
      // Regenerate missing or invalid provenance for an unchanged catalog.
    }
  }

  const manifest = createModelCatalogManifest({
    catalogText,
    sourceText,
    imageCostSourceText,
    generatedAt: new Date().toISOString(),
    modelCount,
  });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  validateModelCatalogArtifacts(catalogText, manifestText);

  writeFileSync(outputPath, catalogText);
  writeFileSync(manifestPath, manifestText);
  console.log(`wrote ${outputPath} (${modelCount} models)`);
  console.log(`wrote ${manifestPath}`);
}

async function fetchProviders(
  url: string,
): Promise<{ text: string; providers: Record<string, unknown> }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  const providers: unknown = JSON.parse(text);
  if (!isRecord(providers)) {
    throw new Error(`${url} did not return a provider object`);
  }
  return { text, providers };
}

function copyBoolean(
  source: Record<string, unknown>,
  target: CatalogEntry,
  key:
    | "attachment"
    | "tool_call"
    | "reasoning"
    | "structured_output"
    | "temperature",
): void {
  const value = source[key];
  if (typeof value === "boolean") target[key] = value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function copyJsonObject(
  record: Record<string, unknown>,
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    output[key] = copyJsonValue(record[key], key);
  }
  return output;
}

function copyJsonValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => copyJsonValue(item, `${path}[${index}]`));
  }
  if (isRecord(value)) return copyJsonObject(value);
  throw new Error(`models.dev cost field "${path}" is not valid JSON`);
}
