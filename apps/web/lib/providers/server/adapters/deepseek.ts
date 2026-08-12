import "server-only";
import { listOpenAIModels } from "@/lib/providers/server/http";
import { createOpenAICompatibleChatModel } from "@/lib/providers/server/transports";
import type { ProviderAdapter } from "@/lib/providers/server/types";

export const deepSeekAdapter: ProviderAdapter = {
  id: "deepseek",
  createLanguageModel(config) {
    return {
      model: createOpenAICompatibleChatModel({
        providerName: "deepseek",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        transformRequestBody: prepareDeepSeekRequest,
      }),
      providerOptionsKey: "deepseek",
    };
  },
  listModels(connection) {
    return listOpenAIModels(connection.baseUrl, connection.apiKey);
  },
};

/** DeepSeek defaults to thinking mode, which rejects forced tool choice. */
export function prepareDeepSeekRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (body.tool_choice !== "required") return body;
  const thinking = body.thinking;
  if (
    thinking &&
    typeof thinking === "object" &&
    !Array.isArray(thinking) &&
    (thinking as Record<string, unknown>).type === "disabled"
  ) {
    return body;
  }
  const { tool_choice: _unsupported, ...compatible } = body;
  void _unsupported;
  return compatible;
}
