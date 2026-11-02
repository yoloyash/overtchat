import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runImageProvider } from "@/lib/providers/server/image-generation";

// Opt in with OPENROUTER_LIVE_API_KEY. Each run buys one image, about two
// cents with the default model. See docs/development.md.
describe("OpenRouter images (live)", () => {
  it.skipIf(!process.env.OPENROUTER_LIVE_API_KEY)(
    "generates one image and reports its charge",
    async () => {
      const result = await runImageProvider(
        {
          providerId: "openrouter",
          baseUrl:
            process.env.OPENROUTER_LIVE_URL ?? "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_LIVE_API_KEY!,
          model:
            process.env.OPENROUTER_LIVE_IMAGE_MODEL ??
            "qwen/qwen-image-2.1-turbo",
        },
        {
          prompt: "A small red paper kite on a plain white background",
          references: [],
          size: "1024x1024",
          quality: "auto",
        },
      );
      expect(result.mediaType).toMatch(/^image\//);
      expect(result.data.byteLength).toBeGreaterThan(1000);
      expect(result.usage?.outputTokens ?? 0).toBeGreaterThan(0);
      expect(result.reportedCost?.totalCostNanoUsd ?? 0).toBeGreaterThan(0);
      console.info(
        `[openrouter-images] ${result.mediaType} ${result.data.byteLength} bytes, ${JSON.stringify(result.usage)}, $${((result.reportedCost?.totalCostNanoUsd ?? 0) / 1e9).toFixed(4)}`,
      );
    },
    120_000,
  );
});
