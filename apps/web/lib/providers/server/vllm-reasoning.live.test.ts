import { afterEach, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { REASONING_OVERRIDE_PRESETS } from "@/lib/model-config/reasoning-override";
import { createTemplateRenderer, listOpenAIModels } from "./http";
import { createConfiguredLanguageModel } from "./registry";
import { checkThinkingLevels } from "./thinking-check";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());

// Explicit opt-in: makes two small generations against an operator's model.
it.skipIf(!process.env.VLLM_LIVE_URL)(
  "checks a thinking preset and exercises on/off through the production adapter",
  async () => {
    const baseUrl = process.env.VLLM_LIVE_URL!;
    const apiKey = process.env.VLLM_LIVE_API_KEY;
    const presetName = process.env.VLLM_LIVE_PRESET ?? "enable_thinking";
    const preset = REASONING_OVERRIDE_PRESETS.find(
      (candidate) => candidate.name === presetName,
    );
    expect(preset).toBeDefined();
    const { requests } = preset!.override as {
      requests: Partial<Record<"on" | "off", Record<string, unknown>>>;
    };
    expect(requests.on && requests.off).toBeTruthy();
    const models = await listOpenAIModels(baseUrl, apiKey);
    const model = process.env.VLLM_LIVE_MODEL ?? models[0]?.id;
    expect(model).toBeDefined();

    const check = await checkThinkingLevels(
      createTemplateRenderer("vllm", baseUrl, apiKey, model!),
      requests,
    );
    expect(check).toMatchObject({ status: "checked", failed: [], identical: [] });

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
    for (const level of ["off", "on"] as const) {
      const configured = createConfiguredLanguageModel({
        providerId: "vllm",
        apiFormat: "auto",
        baseUrl,
        apiKey,
        model: model!,
        providerOptions: null,
        reasoningLevel: level,
        reasoningRequest: requests[level],
      });
      const generation = streamText({
        model: configured.model,
        providerOptions: configured.providerOptions,
        prompt: "What is 17 multiplied by 23? Answer briefly.",
        maxOutputTokens: 512,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const text = await generation.text;
      const reasoningText = (await generation.reasoningText) ?? "";
      expect(sent.at(-1)).toMatchObject(requests[level]!);
      expect(text).toContain("391");
      if (level === "off") expect(reasoningText).toBe("");
      else expect(reasoningText.length).toBeGreaterThan(0);
      generations.push({ level, reasoningCharacters: reasoningText.length });
    }
    console.info(JSON.stringify({ model, preset: presetName, check, generations }));
  },
  180_000,
);
