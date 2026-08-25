import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { listLlamaCppModels } from "@/lib/providers/server/http";

export const llamaCppAdapter = createOpenAICompatibleAdapter(
  "llamacpp",
  (connection) => listLlamaCppModels(connection.baseUrl, connection.apiKey),
  (body) =>
    body.stream === true
      ? {
          ...body,
          // llama.cpp extensions that emit progress and timings in the same
          // SSE stream as the OpenAI-compatible response.
          return_progress: true,
          timings_per_token: true,
        }
      : body,
);
