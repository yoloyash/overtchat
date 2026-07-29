/**
 * Generates the small server-side model catalog used as a fallback when a
 * provider's model-discovery endpoint does not report context limits.
 *
 * The output is committed so self-hosted and air-gapped deployments never
 * depend on models.dev at runtime.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_URL = "https://models.dev/api.json";
const PROVIDERS = [
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["google", "google"],
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
  input_modalities?: string[];
  output_modalities?: string[];
  attachment?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
}

async function main() {
  const outputPath = resolve(
    process.cwd(),
    "lib/providers/server/model-catalog.json",
  );

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${SOURCE_URL}: ${response.status} ${response.statusText}`,
    );
  }

  const upstream = await response.json();
  if (!isRecord(upstream)) {
    throw new Error(`${SOURCE_URL} did not return a provider object`);
  }

  const output: Record<string, Record<string, CatalogEntry>> = {};

  for (const [providerId, sourceProviderId] of PROVIDERS) {
    const sourceProvider = upstream[sourceProviderId];
    if (!isRecord(sourceProvider) || !isRecord(sourceProvider.models)) {
      throw new Error(`models.dev provider "${sourceProviderId}" has no models`);
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

      if (models[id]) {
        throw new Error(`Duplicate models.dev model ID "${providerId}/${id}"`);
      }
      models[id] = entry;
    }

    output[providerId] = models;
  }

  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `wrote ${outputPath} (${Object.values(output).reduce(
      (count, models) => count + Object.keys(models).length,
      0,
    )} models)`,
  );
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
