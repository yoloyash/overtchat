import type { ProviderId } from "@/lib/providers/catalog";
import type { ModelCatalogEntry } from "./model-catalog";

// Fixed inputs for lookup and cost arithmetic tests, not current provider facts.
// Keep these independent of the generated catalog so upstream updates can land.
export default {
  openai: {
    "gpt-4": { cost: { input: 30, output: 60 } },
    "gpt-4o": {
      context: 128_000,
      output: 16_384,
      input_modalities: ["text", "image", "pdf"],
      output_modalities: ["text"],
      attachment: true,
      tool_call: true,
      reasoning: false,
      structured_output: true,
      temperature: true,
    },
    "gpt-5.4": {
      cost: {
        input: 2.5,
        output: 15,
        cache_read: 0.25,
        context_over_200k: { input: 5, output: 22.5, cache_read: 0.5 },
      },
      reasoning_controls: {
        toggle: true,
        defaultLevel: "medium",
        efforts: ["low", "medium", "high", "xhigh"],
      },
    },
    "gpt-5.5": {
      cost: {
        input: 5,
        output: 30,
        cache_read: 0.5,
        tiers: [{
          input: 10,
          output: 45,
          cache_read: 1,
          tier: { size: 272_000, type: "context" },
        }],
      },
    },
  },
  anthropic: {
    "claude-sonnet-4-6": {
      context: 1_000_000,
      output: 128_000,
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      input_modalities: ["text", "image", "pdf"],
      output_modalities: ["text"],
      attachment: true,
      tool_call: true,
      reasoning: true,
      structured_output: true,
      temperature: true,
    },
    "claude-opus-4-7": {
      reasoning_controls: {
        toggle: false,
        defaultLevel: "high",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  google: {
    "gemini-2.5-flash": { context: 1_048_576 },
    "gemini-3.1-pro-preview": {
      reasoning_controls: {
        toggle: false,
        defaultLevel: "high",
        efforts: ["low", "medium", "high"],
      },
    },
  },
  deepseek: {
    "deepseek-v4-flash": {
      context: 1_000_000,
      cost: { input: 0.14, output: 0.28, cache_read: 0.0028 },
      reasoning_controls: {
        toggle: true,
        defaultLevel: "max",
        efforts: ["low", "high", "max"],
      },
    },
  },
  bedrock: {
    "us.anthropic.claude-sonnet-5": { context: 1_000_000 },
    "openai.gpt-5.4": { reasoning: true },
  },
} satisfies Partial<Record<ProviderId, Record<string, ModelCatalogEntry>>>;
