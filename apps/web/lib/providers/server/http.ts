import "server-only";
import type { ModelCapabilities } from "@overtchat/shared";
import type { DiscoveredModel } from "@/lib/providers/server/types";

const MODEL_LIST_TIMEOUT_MS = 10_000;
const MAX_MODEL_LIST_PAGES = 20;

interface OpenAIModelList {
  data?: Array<{
    id?: unknown;
    owned_by?: unknown;
    max_model_len?: unknown;
    max_context_length?: unknown;
    max_output_tokens?: unknown;
    max_tokens?: unknown;
    input_modalities?: unknown;
    output_modalities?: unknown;
    modalities?: unknown;
    architecture?: unknown;
    capabilities?: unknown;
  }>;
}

interface AnthropicModelList {
  data?: Array<{
    id?: unknown;
    max_input_tokens?: unknown;
    max_tokens?: unknown;
    capabilities?: unknown;
  }>;
  has_more?: boolean;
  last_id?: string | null;
}

interface GoogleModelList {
  models?: Array<{
    name?: unknown;
    inputTokenLimit?: unknown;
    outputTokenLimit?: unknown;
    thinking?: unknown;
    temperature?: unknown;
    maxTemperature?: unknown;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
}

interface LlamaCppProps {
  default_generation_settings?: {
    n_ctx?: unknown;
  };
  chat_template_caps?: unknown;
  modalities?: unknown;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function appendPath(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

export async function listOpenAIModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<DiscoveredModel[]> {
  const json = await fetchJson<OpenAIModelList>(appendPath(baseUrl, "models"), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  const models = normalizeDiscoveredModels(
    json.data?.map((model) => ({
      id: model.id,
      contextWindow:
        readPositiveInteger(model.max_model_len) ??
        readPositiveInteger(model.max_context_length),
      capabilities: openAIModelCapabilities(model),
    })),
  );

  const llamaModelIds = new Set(
    json.data
      ?.filter(
        (model) =>
          typeof model.owned_by === "string" &&
          model.owned_by.toLowerCase() === "llamacpp",
      )
      .flatMap((model) => {
        if (typeof model.id !== "string") return [];
        const id = model.id.trim().replace(/^models\//, "");
        return id ? [id] : [];
      }) ?? [],
  );

  if (llamaModelIds.size === 0) return models;

  return Promise.all(
    models.map(async (model) => {
      if (!llamaModelIds.has(model.id)) return model;
      const props = await readLlamaCppProps(baseUrl, apiKey, model.id);
      if (!props) return model;
      return {
        ...model,
        contextWindow:
          readPositiveInteger(props.default_generation_settings?.n_ctx) ??
          model.contextWindow,
        capabilities: mergeCapabilities(
          model.capabilities,
          llamaCppCapabilities(props),
        ),
      };
    }),
  );
}

export async function listAnthropicModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<DiscoveredModel[]> {
  const models: Array<{
    id?: unknown;
    contextWindow?: unknown;
    capabilities?: ModelCapabilities;
  }> = [];
  let afterId: string | null = null;

  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(appendPath(baseUrl, "models"));
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);

    const json = await fetchJson<AnthropicModelList>(url.toString(), {
      headers: {
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    models.push(
      ...(json.data?.map((model) => ({
        id: model.id,
        contextWindow: readPositiveInteger(model.max_input_tokens),
        capabilities: anthropicModelCapabilities(model),
      })) ?? []),
    );

    if (!json.has_more || !json.last_id || json.last_id === afterId) break;
    afterId = json.last_id;
  }

  return normalizeDiscoveredModels(models);
}

export async function listGoogleModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<DiscoveredModel[]> {
  const models: Array<{
    id?: unknown;
    contextWindow?: unknown;
    capabilities?: ModelCapabilities;
  }> = [];
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(appendPath(baseUrl, "models"));
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson<GoogleModelList>(url.toString(), {
      headers: apiKey ? { "x-goog-api-key": apiKey } : {},
    });
    models.push(
      ...(json.models ?? [])
        .filter((model) =>
          model.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((model) => ({
          id: model.name,
          contextWindow: readPositiveInteger(model.inputTokenLimit),
          capabilities: googleModelCapabilities(model),
        })),
    );

    if (!json.nextPageToken || json.nextPageToken === pageToken) break;
    pageToken = json.nextPageToken;
  }

  return normalizeDiscoveredModels(models);
}

async function fetchJson<T>(
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
    throw new Error(
      `Upstream ${response.status} ${response.statusText}${suffix}`,
    );
  }
  return (await response.json()) as T;
}

function normalizeDiscoveredModels(
  models:
    | Array<{
        id?: unknown;
        contextWindow?: unknown;
        capabilities?: ModelCapabilities;
      }>
    | undefined,
): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();

  for (const candidate of models ?? []) {
    if (typeof candidate.id !== "string") continue;
    const id = candidate.id.trim().replace(/^models\//, "");
    if (!id) continue;

    const contextWindow = readPositiveInteger(candidate.contextWindow);
    const capabilities = compactCapabilities(candidate.capabilities);
    const existing = byId.get(id);
    if (existing) {
      if (existing.contextWindow === undefined && contextWindow !== undefined) {
        existing.contextWindow = contextWindow;
      }
      existing.capabilities = mergeCapabilities(
        existing.capabilities,
        capabilities,
      );
      continue;
    }

    byId.set(id, {
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(capabilities === undefined ? {} : { capabilities }),
    });
  }

  return [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function openAIModelCapabilities(
  model: NonNullable<OpenAIModelList["data"]>[number],
): ModelCapabilities | undefined {
  const modalities = firstRecord(model.modalities, model.architecture);
  const capabilities = isRecord(model.capabilities)
    ? model.capabilities
    : undefined;
  return compactCapabilities({
    maxOutputTokens:
      readPositiveInteger(model.max_output_tokens) ??
      readPositiveInteger(model.max_tokens),
    inputModalities:
      readStringArray(model.input_modalities) ??
      readStringArray(modalities?.input_modalities) ??
      readStringArray(modalities?.input),
    outputModalities:
      readStringArray(model.output_modalities) ??
      readStringArray(modalities?.output_modalities) ??
      readStringArray(modalities?.output),
    attachment: readSupportedBoolean(capabilities?.attachment),
    toolCalling:
      readSupportedBoolean(capabilities?.tool_call) ??
      readSupportedBoolean(capabilities?.tool_calling) ??
      readSupportedBoolean(capabilities?.tools),
    reasoning: readSupportedBoolean(capabilities?.reasoning),
    structuredOutput:
      readSupportedBoolean(capabilities?.structured_output) ??
      readSupportedBoolean(capabilities?.structured_outputs),
    temperature: readSupportedBoolean(capabilities?.temperature),
  });
}

function anthropicModelCapabilities(
  model: NonNullable<AnthropicModelList["data"]>[number],
): ModelCapabilities | undefined {
  const capabilities = isRecord(model.capabilities)
    ? model.capabilities
    : undefined;
  const imageInput = readSupportedBoolean(capabilities?.image_input);
  const pdfInput = readSupportedBoolean(capabilities?.pdf_input);
  const inputModalities =
    imageInput !== undefined || pdfInput !== undefined
      ? [
          "text",
          ...(imageInput ? ["image"] : []),
          ...(pdfInput ? ["pdf"] : []),
        ]
      : undefined;

  return compactCapabilities({
    maxOutputTokens: readPositiveInteger(model.max_tokens),
    inputModalities,
    outputModalities: capabilities ? ["text"] : undefined,
    attachment:
      imageInput === undefined && pdfInput === undefined
        ? undefined
        : imageInput === true || pdfInput === true,
    reasoning: readSupportedBoolean(capabilities?.thinking),
    structuredOutput: readSupportedBoolean(
      capabilities?.structured_outputs,
    ),
  });
}

function googleModelCapabilities(
  model: NonNullable<GoogleModelList["models"]>[number],
): ModelCapabilities | undefined {
  return compactCapabilities({
    maxOutputTokens: readPositiveInteger(model.outputTokenLimit),
    reasoning:
      typeof model.thinking === "boolean" ? model.thinking : undefined,
    temperature:
      typeof model.temperature === "number" ||
      typeof model.maxTemperature === "number"
        ? true
        : undefined,
  });
}

async function readLlamaCppProps(
  baseUrl: string,
  apiKey: string | null | undefined,
  model: string,
): Promise<LlamaCppProps | undefined> {
  try {
    const url = new URL(appendPath(openAIServiceRoot(baseUrl), "props"));
    url.searchParams.set("model", model);
    return await fetchJson<LlamaCppProps>(url.toString(), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
  } catch {
    // /props is a llama.cpp extension. Older versions and compatibility
    // proxies may omit it; model discovery must still succeed.
    return undefined;
  }
}

function openAIServiceRoot(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = url.pathname.replace(/\/v1$/, "");
  url.search = "";
  url.hash = "";
  return normalizeBaseUrl(url.toString());
}

function llamaCppCapabilities(
  props: LlamaCppProps,
): ModelCapabilities | undefined {
  const template = isRecord(props.chat_template_caps)
    ? props.chat_template_caps
    : undefined;
  const modalities = isRecord(props.modalities)
    ? props.modalities
    : undefined;
  const vision =
    typeof modalities?.vision === "boolean" ? modalities.vision : undefined;
  return compactCapabilities({
    inputModalities:
      vision === undefined ? undefined : vision ? ["text", "image"] : ["text"],
    outputModalities: vision === undefined ? undefined : ["text"],
    attachment: vision,
    toolCalling: readSupportedBoolean(template?.supports_tools),
    reasoning: readSupportedBoolean(template?.supports_preserve_reasoning),
    temperature: true,
  });
}

function mergeCapabilities(
  fallback: ModelCapabilities | undefined,
  preferred: ModelCapabilities | undefined,
): ModelCapabilities | undefined {
  return compactCapabilities({ ...fallback, ...preferred });
}

function compactCapabilities(
  capabilities: ModelCapabilities | undefined,
): ModelCapabilities | undefined {
  if (!capabilities) return undefined;
  const defined = Object.fromEntries(
    Object.entries(capabilities).filter(([, value]) => value !== undefined),
  ) as ModelCapabilities;
  return Object.keys(defined).length > 0 ? defined : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [
    ...new Set(
      value.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      ),
    ),
  ];
  return result.length > 0 ? result : undefined;
}

function readSupportedBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (!isRecord(value)) return undefined;
  return typeof value.supported === "boolean" ? value.supported : undefined;
}

function firstRecord(
  ...values: unknown[]
): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
