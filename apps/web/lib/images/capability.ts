import "server-only";
import type { ImageCapability } from "@overtchat/shared";
import { getImageModelConfig } from "@/lib/db/modelConfigs";
import { customImageOptions } from "@/lib/model-config/image-options";

export function getImageCapability(): ImageCapability {
  const config = getImageModelConfig();
  const custom =
    config?.providerId === "custom"
      ? customImageOptions(config.providerOptions)
      : undefined;
  return {
    available: Boolean(config),
    model: config?.model ?? null,
    supportsQuality: config?.providerId === "openai",
    ...(custom
      ? {
          configuredSize: custom.size,
          supportsEditing: custom.supportsEditing,
        }
      : {}),
  };
}
