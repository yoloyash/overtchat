import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { listLlamaCppModels } from "@/lib/providers/server/http";

export const llamaCppAdapter = createOpenAICompatibleAdapter(
  "llamacpp",
  (connection) => listLlamaCppModels(connection.baseUrl, connection.apiKey),
);
