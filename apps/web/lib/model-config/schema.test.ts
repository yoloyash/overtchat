import { describe, expect, it } from "vitest";
import { modelSupportsToolCalling } from "@overtchat/shared";

import { ModelConfigSchema, ProviderConnectionSchema } from "./schema";

describe("provider configuration", () => {
  it("accepts automatic routing for a registered provider", () => {
    expect(
      ProviderConnectionSchema.safeParse({
        providerId: "bedrock",
        apiFormat: "auto",
        baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1/",
        apiKey: "secret",
      }),
    ).toMatchObject({
      success: true,
      data: {
        baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
      },
    });
  });

  it("requires custom endpoints to declare an API format", () => {
    const result = ProviderConnectionSchema.safeParse({
      providerId: "custom",
      apiFormat: "auto",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("explicit API format");
    }
  });

  it("rejects protocol overrides for providers that own their routing", () => {
    const result = ProviderConnectionSchema.safeParse({
      providerId: "openai",
      apiFormat: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects endpoints that are not absolute HTTP URLs", () => {
    const result = ProviderConnectionSchema.safeParse({
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "localhost:11434/v1",
      apiKey: "",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes the complete model configuration", () => {
    const result = ModelConfigSchema.parse({
      label: "  Local model  ",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "http://localhost:8000/v1///",
      apiKey: "",
      model: "  qwen  ",
      systemPrompt: "  Be concise.  ",
      providerOptions: undefined,
    });
    expect(result).toMatchObject({
      label: "Local model",
      baseUrl: "http://localhost:8000/v1",
      model: "qwen",
      systemPrompt: "Be concise.",
      providerOptions: null,
      toolCallingEnabled: true,
      enabled: true,
      sortOrder: 0,
    });
  });

  it("preserves an explicit tool-calling capability override", () => {
    const result = ModelConfigSchema.parse({
      label: "Text only",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "http://localhost:8000/v1",
      apiKey: "",
      model: "text-only",
      toolCallingEnabled: false,
    });

    expect(result.toolCallingEnabled).toBe(false);
  });

  it("treats disabled models as tool-incompatible without breaking old DTOs", () => {
    expect(modelSupportsToolCalling({ toolCallingEnabled: false })).toBe(false);
    expect(modelSupportsToolCalling({})).toBe(true);
    expect(modelSupportsToolCalling(null)).toBe(false);
  });
});
