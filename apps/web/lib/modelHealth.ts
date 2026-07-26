import "server-only";
import { generateText, tool } from "ai";
import { z } from "zod";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";
import type { ProviderModelConfig } from "@/lib/providers/server/types";

const CONNECTION_CHECK_TOOL_NAME = "connection_check";
const connectionCheckTools = {
  [CONNECTION_CHECK_TOOL_NAME]: tool({
    description: "Confirm that this model can call an application tool.",
    inputSchema: z.object({}),
    execute: async () => ({ ok: true }),
  }),
};

export type PingResult =
  | {
      ok: true;
      text: string;
      elapsedMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      ok: false;
      error: string;
      elapsedMs: number;
      kind: "configuration" | "upstream";
    };

export async function pingModel(
  config: ProviderModelConfig,
): Promise<PingResult> {
  const started = Date.now();
  try {
    const { model, providerOptions } = createConfiguredLanguageModel(config);
    const verifyToolCalling = config.toolCallingEnabled !== false;
    const result = await generateText({
      model,
      ...(verifyToolCalling
        ? {
            instructions: `Call ${CONNECTION_CHECK_TOOL_NAME} exactly once.`,
            prompt: "Verify this model connection.",
            tools: connectionCheckTools,
            toolChoice: "required" as const,
          }
        : { prompt: "Say hi in one short sentence." }),
      maxOutputTokens: 64,
      abortSignal: AbortSignal.timeout(30_000),
      providerOptions,
    });

    if (
      verifyToolCalling &&
      !result.toolCalls.some(
        (toolCall) => toolCall.toolName === CONNECTION_CHECK_TOOL_NAME,
      )
    ) {
      throw new Error(
        "Connection succeeded, but the model did not call the required test tool. Turn off Tool calling if this model does not support tools.",
      );
    }

    return {
      ok: true,
      text: verifyToolCalling ? "Tool calling verified." : result.text.trim(),
      elapsedMs: Date.now() - started,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
      kind: isProviderConfigurationError(err) ? "configuration" : "upstream",
    };
  }
}
