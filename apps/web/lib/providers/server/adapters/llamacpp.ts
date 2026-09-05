import "server-only";
import { createOpenAICompatibleAdapter } from "@/lib/providers/server/adapters/openai-compatible";
import { applyLocalReasoningLevel } from "@/lib/providers/server/adapters/local-reasoning";
import { listLlamaCppModels } from "@/lib/providers/server/http";

export const llamaCppAdapter = createOpenAICompatibleAdapter(
  "llamacpp",
  {
    listModels: (connection) =>
      listLlamaCppModels(connection.baseUrl, connection.apiKey),
    transformRequestBody: (body, config) => {
      const withRuntimeExtensions = body.stream === true
        ? {
            ...body,
            // llama.cpp extensions that emit progress and timings in the same
            // SSE stream as the OpenAI-compatible response.
            return_progress: true,
            timings_per_token: true,
          }
        : body;
      return applyLocalReasoningLevel(
        withRuntimeExtensions,
        config.reasoningLevel,
      );
    },
    acceptsReasoningLevel: true,
  },
);
