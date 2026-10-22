import { writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { listVllmModels } from "./http";
import { createConfiguredLanguageModel } from "./registry";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());

// Explicit opt-in: makes two small generations against an operator's model.
it.skipIf(!process.env.VLLM_LIVE_URL)(
  "discovers the live model and exercises thinking on/off through the production adapter",
  async () => {
    const baseUrl = process.env.VLLM_LIVE_URL!;
    const apiKey = process.env.VLLM_LIVE_API_KEY;
    const models = await listVllmModels(baseUrl, apiKey);
    const model = process.env.VLLM_LIVE_MODEL
      ? models.find((item) => item.id === process.env.VLLM_LIVE_MODEL)
      : models[0];
    expect(model).toBeDefined();
    const controls = model!.capabilities?.reasoningControls;
    expect(controls?.toggle).toBe(true);
    expect(controls?.requestMapping?.toggleParameter).toBeDefined();
    const requests: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/chat/completions"))
          requests.push(JSON.parse(String(init?.body)));
        return originalFetch(input, init);
      },
    );
    const evidence = [];
    for (const level of ["off", "on"] as const) {
      const configured = createConfiguredLanguageModel({
        providerId: "vllm",
        apiFormat: "auto",
        baseUrl,
        apiKey,
        model: model!.id,
        providerOptions: null,
        reasoningLevel: level,
        reasoningMapping: controls?.requestMapping,
      });
      const generation = streamText({
        model: configured.model,
        providerOptions: configured.providerOptions,
        prompt: "What is 17 multiplied by 23? Answer briefly.",
        maxOutputTokens: 512,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const result = {
        text: await generation.text,
        reasoningText: await generation.reasoningText,
        finishReason: await generation.finishReason,
        usage: await generation.usage,
      };
      expect(requests.at(-1)?.stream).toBe(true);
      expect(result.text).toContain("391");
      if (level === "off") expect(result.reasoningText ?? "").toBe("");
      else expect(result.reasoningText?.length).toBeGreaterThan(0);
      expect(requests.at(-1)?.chat_template_kwargs).toMatchObject({
        [controls!.requestMapping!.toggleParameter!]: level === "on",
      });
      expect(requests.at(-1)).not.toHaveProperty("reasoning_effort");
      evidence.push({
        level,
        finishReason: result.finishReason,
        reasoningCharacters: result.reasoningText?.length ?? 0,
        outputTokens: result.usage.outputTokens,
      });
    }
    const report = JSON.stringify(
      {
        model: model!.id,
        detection: model!.reasoningDetection,
        controls,
        generations: evidence,
      },
      null,
      2,
    );
    console.info(report);
    if (process.env.VLLM_LIVE_REPORT)
      writeFileSync(process.env.VLLM_LIVE_REPORT, report);
  },
  180_000,
);
