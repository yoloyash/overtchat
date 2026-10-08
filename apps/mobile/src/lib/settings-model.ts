import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import { PROVIDERS, type ProviderId } from "@overtchat/shared/provider-catalog";
export type ModelDraft = Pick<
  AdminModelConfig,
  | "modelType"
  | "label"
  | "providerId"
  | "apiFormat"
  | "baseUrl"
  | "apiKey"
  | "model"
  | "pricing"
  | "contextWindow"
  | "discoveredContextWindow"
  | "discoveredCapabilities"
  | "systemPrompt"
  | "providerOptions"
  | "toolCallingEnabled"
  | "enabled"
>;
export function modelDraft(model?: AdminModelConfig): ModelDraft {
  if (!model)
    return {
      modelType: "chat",
      label: "",
      providerId: "openai",
      apiFormat: "auto",
      baseUrl: PROVIDERS.openai.defaultBaseUrl,
      apiKey: null,
      model: "",
      pricing: null,
      contextWindow: null,
      discoveredContextWindow: null,
      discoveredCapabilities: null,
      systemPrompt: null,
      providerOptions: null,
      toolCallingEnabled: true,
      enabled: true,
    };
  const {
    modelType,
    label,
    providerId,
    apiFormat,
    baseUrl,
    apiKey,
    model: name,
    pricing,
    contextWindow,
    discoveredContextWindow,
    discoveredCapabilities,
    systemPrompt,
    providerOptions,
    toolCallingEnabled,
    enabled,
  } = model;
  return {
    modelType,
    label,
    providerId,
    apiFormat,
    baseUrl,
    apiKey,
    model: name,
    pricing,
    contextWindow,
    discoveredContextWindow,
    discoveredCapabilities,
    systemPrompt,
    providerOptions,
    toolCallingEnabled,
    enabled,
  };
}
export function changeModelProvider(
  draft: ModelDraft,
  providerId: ProviderId,
): ModelDraft {
  return {
    ...draft,
    providerId,
    apiFormat: PROVIDERS[providerId].defaultApiFormat,
    baseUrl: PROVIDERS[providerId].defaultBaseUrl,
    apiKey: null,
    model: "",
    providerOptions: null,
    discoveredContextWindow: null,
    discoveredCapabilities: null,
  };
}
export function parseModelDraft(
  draft: ModelDraft,
  options: string,
  context: string,
): ModelDraft {
  if (!draft.label.trim() || !draft.model.trim())
    throw new Error("Enter a display name and model ID.");
  const url = new URL(draft.baseUrl.trim());
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an HTTP or HTTPS endpoint.");
  if (PROVIDERS[draft.providerId].requiresApiKey && !draft.apiKey?.trim())
    throw new Error("Enter the provider API key.");
  let providerOptions: Record<string, unknown> | null = null;
  if (options.trim()) {
    const parsed = JSON.parse(options);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Provider options must be a JSON object.");
    providerOptions = parsed;
  }
  const contextWindow = context.trim() ? Number(context) : null;
  if (
    contextWindow !== null &&
    (!Number.isSafeInteger(contextWindow) || contextWindow < 1)
  )
    throw new Error("Context window must be a positive integer.");
  if (
    draft.pricing &&
    Object.values(draft.pricing).some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error("Pricing must contain non-negative numbers.");
  return {
    ...draft,
    label: draft.label.trim(),
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey?.trim() || null,
    providerOptions,
    contextWindow,
  };
}
