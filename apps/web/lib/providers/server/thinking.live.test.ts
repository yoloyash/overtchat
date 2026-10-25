import { writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { streamText } from "ai";
import {
  MODEL_REASONING_LEVELS,
  REASONING_OVERRIDE_PRESETS,
  ReasoningOverrideSchema,
  type ReasoningOverride,
} from "@/lib/model-config/reasoning-override";
import { createTemplateRenderer, listOpenAIModels } from "./http";
import { createConfiguredLanguageModel } from "./registry";
import { checkThinkingLevels } from "./thinking-check";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());

// Explicit opt-in: makes one small generation per configured level against an
// operator's model.
it.skipIf(!process.env.THINKING_LIVE_URL)(
  "sends each configured thinking level through the production adapter",
  async () => {
    const baseUrl = process.env.THINKING_LIVE_URL!;
    const apiKey = process.env.THINKING_LIVE_API_KEY;
    const providerId = (process.env.THINKING_LIVE_PROVIDER ?? "vllm") as
      | "vllm"
      | "llamacpp"
      | "sglang"
      | "custom";
    const override: ReasoningOverride = process.env.THINKING_LIVE_REQUESTS
      ? ReasoningOverrideSchema.parse({
          defaultLevel: process.env.THINKING_LIVE_DEFAULT,
          requests: JSON.parse(process.env.THINKING_LIVE_REQUESTS),
        })
      : REASONING_OVERRIDE_PRESETS[0].override;
    const levels = MODEL_REASONING_LEVELS.filter(
      (level) => level in override.requests,
    );
    expect(levels.length).toBeGreaterThan(0);
    const model =
      process.env.THINKING_LIVE_MODEL ??
      (await listOpenAIModels(baseUrl, apiKey))[0]?.id;
    expect(model).toBeDefined();

    const check =
      providerId === "vllm" || providerId === "llamacpp"
        ? await checkThinkingLevels(
            createTemplateRenderer(providerId, baseUrl, apiKey, model!),
            override.requests,
          )
        : undefined;
    if (check) {
      expect(check).toMatchObject({
        status: "checked",
        failed: [],
        identical: [],
      });
    }

    const sent: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/chat/completions")) {
          sent.push(JSON.parse(String(init?.body)));
        }
        return originalFetch(input, init);
      },
    );
    const generations = [];
    for (const level of levels) {
      const configured = createConfiguredLanguageModel({
        providerId,
        apiFormat: providerId === "custom" ? "openai-chat" : "auto",
        baseUrl,
        apiKey,
        model: model!,
        providerOptions: null,
        reasoningLevel: level,
        reasoningRequest: override.requests[level],
      });
      const generation = streamText({
        model: configured.model,
        providerOptions: configured.providerOptions,
        prompt: "What is 17 multiplied by 23? Answer briefly.",
        maxOutputTokens: 4096,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(180_000),
      });
      const text = await generation.text;
      const reasoningText = (await generation.reasoningText) ?? "";
      const usage = await generation.usage;
      expect(sent.at(-1)).toMatchObject(override.requests[level]!);
      expect(text).toContain("391");
      if (level === "off") expect(reasoningText).toBe("");
      if (level === "on") expect(reasoningText.length).toBeGreaterThan(0);
      generations.push({
        level,
        reasoningCharacters: reasoningText.length,
        outputTokens: usage.outputTokens,
      });
    }
    const report = JSON.stringify(
      { model, providerId, check, generations },
      null,
      2,
    );
    console.info(report);
    if (process.env.THINKING_LIVE_REPORT) {
      writeFileSync(process.env.THINKING_LIVE_REPORT, report);
    }
  },
  600_000,
);
