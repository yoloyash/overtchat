import "server-only";
import {
  REASONING_EFFORTS,
  type ModelCapabilities,
  type ModelReasoningControls,
  type ReasoningEffort,
} from "@overtchat/shared";
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

interface RenderProbeResult {
  key: string;
  text?: string;
  tokenIds?: number[];
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
  return listOpenAIModelsWithOptions(baseUrl, apiKey, false);
}

export async function listLlamaCppModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<DiscoveredModel[]> {
  return listOpenAIModelsWithOptions(baseUrl, apiKey, true);
}

export async function listVllmModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<DiscoveredModel[]> {
  const models = await listOpenAIModelsWithOptions(baseUrl, apiKey, false);
  return Promise.all(
    models.map(async (model) => {
      const reasoningControls = await discoverReasoningControls(
        (level) => renderVllmChatTemplate(baseUrl, apiKey, model.id, level),
        true,
        (prompt) =>
          detokenizeVllmPrompt(baseUrl, apiKey, model.id, prompt.tokenIds),
      );
      return reasoningControls
        ? {
            ...model,
            capabilities: mergeCapabilities(model.capabilities, {
              reasoning: true,
              reasoningControls,
            }),
          }
        : model;
    }),
  );
}

async function listOpenAIModelsWithOptions(
  baseUrl: string,
  apiKey: string | null | undefined,
  probeAllLlamaCppProps: boolean,
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
          probeAllLlamaCppProps ||
          (typeof model.owned_by === "string" &&
            model.owned_by.toLowerCase() === "llamacpp"),
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
      const reasoningControls = probeAllLlamaCppProps
        ? await discoverLlamaCppReasoningControls(
            baseUrl,
            apiKey,
            model.id,
            props,
          )
        : undefined;
      return {
        ...model,
        contextWindow:
          readPositiveInteger(props.default_generation_settings?.n_ctx) ??
          model.contextWindow,
        capabilities: mergeCapabilities(
          model.capabilities,
          llamaCppCapabilities(props, reasoningControls),
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
  reasoningControls?: ModelReasoningControls,
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
    reasoning:
      reasoningControls !== undefined
        ? true
        : readSupportedBoolean(template?.supports_preserve_reasoning),
    reasoningControls,
    temperature: true,
  });
}

async function discoverLlamaCppReasoningControls(
  baseUrl: string,
  apiKey: string | null | undefined,
  model: string,
  props: LlamaCppProps,
): Promise<ModelReasoningControls | undefined> {
  const templateCaps = isRecord(props.chat_template_caps)
    ? props.chat_template_caps
    : undefined;
  const supportsEffort =
    readSupportedBoolean(templateCaps?.supports_reasoning_effort) === true;
  return discoverReasoningControls(
    (level) =>
      renderLlamaCppChatTemplate(baseUrl, apiKey, model, level),
    supportsEffort,
  );
}

type ProbeLevel = "default" | "off" | "on" | ReasoningEffort | "invalid";

async function discoverReasoningControls(
  render: (level: ProbeLevel) => Promise<RenderProbeResult | undefined>,
  probeEfforts = true,
  resolvePromptText?: (
    prompt: RenderProbeResult,
  ) => Promise<string | undefined>,
): Promise<ModelReasoningControls | undefined> {
  const [defaultPrompt, offPrompt, onPrompt] = await Promise.all([
    render("default"),
    render("off"),
    render("on"),
  ]);
  if (!defaultPrompt) return undefined;

  const toggle = Boolean(
    offPrompt && onPrompt && onPrompt.key !== offPrompt.key,
  );
  const defaultToggleLevel = !toggle
    ? undefined
    : defaultPrompt.key === offPrompt?.key
      ? "off"
      : defaultPrompt.key === onPrompt?.key
        ? "on"
        : undefined;

  if (!probeEfforts) {
    return defaultToggleLevel
      ? { toggle: true, defaultLevel: defaultToggleLevel }
      : undefined;
  }

  const [invalidPrompt, ...effortPrompts] = await Promise.all([
    render("invalid"),
    ...REASONING_EFFORTS.map((effort) => render(effort)),
  ]);
  const groups = new Map<
    string,
    { aliases: ReasoningEffort[]; prompt: RenderProbeResult }
  >();
  for (let index = 0; index < REASONING_EFFORTS.length; index += 1) {
    const prompt = effortPrompts[index];
    if (!prompt) continue;
    const effort = REASONING_EFFORTS[index];
    const group = groups.get(prompt.key) ?? { aliases: [], prompt };
    group.aliases.push(effort);
    groups.set(prompt.key, group);
  }

  const projectedGroups = await Promise.all(
    [...groups].map(async ([key, group]) => {
      const matchesInvalid = key === invalidPrompt?.key;
      if (group.aliases.length === 1 && !matchesInvalid) {
        return [key, group.aliases[0]] as const;
      }
      const promptText =
        group.prompt.text ?? (await resolvePromptText?.(group.prompt));
      const projected = projectedEffortAlias(group.aliases, promptText);
      return projected ? ([key, projected] as const) : undefined;
    }),
  );
  const selectedByPrompt = new Map(
    projectedGroups.filter(
      (group): group is readonly [string, ReasoningEffort] => group !== undefined,
    ),
  );
  const defaultLevel =
    selectedByPrompt.get(defaultPrompt.key) ?? defaultToggleLevel;
  if (!defaultLevel) return undefined;
  const selected = new Set(selectedByPrompt.values());
  const efforts = REASONING_EFFORTS.filter((effort) => selected.has(effort));
  if (efforts.length > 0) return { toggle, defaultLevel, efforts };
  return defaultToggleLevel
    ? { toggle: true, defaultLevel: defaultToggleLevel }
    : undefined;
}

function projectedEffortAlias(
  aliases: ReasoningEffort[],
  prompt: string | undefined,
): ReasoningEffort | undefined {
  if (!prompt) return undefined;
  const matches = aliases.filter((alias) =>
    new RegExp(`(^|[^a-z0-9_])${alias}([^a-z0-9_]|$)`, "iu").test(prompt),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

async function renderLlamaCppChatTemplate(
  baseUrl: string,
  apiKey: string | null | undefined,
  model: string,
  level: ProbeLevel,
): Promise<RenderProbeResult | undefined> {
  const body = reasoningProbeBody(model, level);
  const json = await tryFetchJson<Record<string, unknown>>(
    appendPath(openAIServiceRoot(baseUrl), "apply-template"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  return renderedPromptKey(json);
}

async function renderVllmChatTemplate(
  baseUrl: string,
  apiKey: string | null | undefined,
  model: string,
  level: ProbeLevel,
): Promise<RenderProbeResult | undefined> {
  const json = await tryFetchJson<Record<string, unknown>>(
    appendPath(baseUrl, "chat/completions/render"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...reasoningProbeBody(model, level),
        return_prompt_text: true,
        max_tokens: 1,
      }),
    },
  );
  return renderedPromptKey(json);
}

async function detokenizeVllmPrompt(
  baseUrl: string,
  apiKey: string | null | undefined,
  model: string,
  tokenIds: number[] | undefined,
): Promise<string | undefined> {
  if (!tokenIds) return undefined;
  const json = await tryFetchJson<Record<string, unknown>>(
    appendPath(openAIServiceRoot(baseUrl), "detokenize"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, tokens: tokenIds }),
    },
  );
  return typeof json?.prompt === "string" ? json.prompt : undefined;
}

function reasoningProbeBody(model: string, level: ProbeLevel) {
  return {
    model,
    messages: [{ role: "user", content: "hi" }],
    ...(level === "default"
      ? {}
      : level === "on"
        ? { chat_template_kwargs: { enable_thinking: true } }
        : {
            reasoning_effort:
              level === "off"
                ? "none"
                : level === "invalid"
                  ? "overtchat-invalid-effort"
                  : level,
            chat_template_kwargs: {
              enable_thinking: level !== "off",
            },
          }),
  };
}

function renderedPromptKey(
  json: Record<string, unknown> | undefined,
): RenderProbeResult | undefined {
  if (!json) return undefined;
  if (typeof json.prompt === "string") {
    return { key: `text:${json.prompt}`, text: json.prompt };
  }
  if (typeof json.prompt_text === "string") {
    return { key: `text:${json.prompt_text}`, text: json.prompt_text };
  }
  const tokenIds = Array.isArray(json.token_ids)
    ? json.token_ids
    : Array.isArray(json.prompt_token_ids)
      ? json.prompt_token_ids
      : undefined;
  if (
    tokenIds &&
    tokenIds.every(
      (token) => typeof token === "number" && Number.isInteger(token),
    )
  ) {
    return { key: `tokens:${JSON.stringify(tokenIds)}`, tokenIds };
  }
  return undefined;
}

async function tryFetchJson<T>(
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<T | undefined> {
  try {
    return await fetchJson<T>(url, init);
  } catch {
    // Render endpoints are runtime extensions and older servers may omit them.
    // Discovery fails closed so an unverified control is never shown.
    return undefined;
  }
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
