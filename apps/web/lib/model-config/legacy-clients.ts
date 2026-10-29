import { CLIENT_HEADER } from "@overtchat/shared";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import type { ProviderId } from "@/lib/providers/catalog";
import type { ModelConfigInput } from "./schema";

/**
 * Provider IDs known to clients released before {@link CLIENT_HEADER}. Those
 * clients index their bundled catalog by `providerId` and fail on newer IDs.
 * Keep this list frozen; new providers belong only in the shared catalog.
 */
const LEGACY_CLIENT_PROVIDER_IDS: readonly string[] = Object.freeze([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "bedrock",
  "vllm",
  "llamacpp",
  "sglang",
  "custom",
]);

function isLegacyClient(req: Request): boolean {
  return !req.headers.has(CLIENT_HEADER);
}

function isLegacyProvider(providerId: ProviderId): boolean {
  return LEGACY_CLIENT_PROVIDER_IDS.includes(providerId);
}

/**
 * Presents a newer provider as the custom Chat Completions endpoint it is
 * compatible with, so older clients can list and edit it.
 */
export function adminModelConfigForClient(
  req: Request,
  config: AdminModelConfig,
): AdminModelConfig {
  if (!isLegacyClient(req) || isLegacyProvider(config.providerId)) {
    return config;
  }
  return { ...config, providerId: "custom", apiFormat: "openai-chat" };
}

/**
 * Restores a newer provider when an older client saves the custom view from
 * {@link adminModelConfigForClient} without changing its endpoint.
 */
export function restoreNewerProvider(
  req: Request,
  input: ModelConfigInput,
  existing: { providerId: ProviderId; baseUrl: string },
): ModelConfigInput {
  if (
    !isLegacyClient(req) ||
    isLegacyProvider(existing.providerId) ||
    input.providerId !== "custom" ||
    input.apiFormat !== "openai-chat" ||
    input.baseUrl !== existing.baseUrl
  ) {
    return input;
  }
  return { ...input, providerId: existing.providerId, apiFormat: "auto" };
}
