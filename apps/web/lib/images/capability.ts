import "server-only";
import type { ImageCapability } from "@overtchat/shared";
import { getImageModelConfig } from "@/lib/db/modelConfigs";

export function getImageCapability(): ImageCapability {
  const config = getImageModelConfig();
  return {
    available: Boolean(config),
    model: config?.model ?? null,
    supportsQuality: config?.providerId === "openai",
  };
}
