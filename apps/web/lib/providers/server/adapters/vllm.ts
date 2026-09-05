import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { applyLocalReasoningLevel } from "@/lib/providers/server/adapters/local-reasoning";
import { listVllmModels } from "@/lib/providers/server/http";

export const vllmAdapter = createOpenAICompatibleAdapter(
  "vllm",
  (connection) => listVllmModels(connection.baseUrl, connection.apiKey),
  (body, config) => applyLocalReasoningLevel(body, config.reasoningLevel),
);
