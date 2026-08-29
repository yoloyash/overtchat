import { describe, expect, it } from "vitest";
import { claudeModesForModels, parseClaudeModels } from "./models";

describe("Claude model catalog", () => {
  it("maps SDK models, effort controls, images, and Auto support", () => {
    const native = [
      {
        value: "haiku",
        displayName: "Claude Haiku",
        description: "Fast",
        supportsAdaptiveThinking: true,
        supportsEffort: true,
        supportedEffortLevels: [
          "low",
          "medium",
          "high",
        ] as Array<"low" | "medium" | "high">,
        supportsAutoMode: true,
      },
    ];
    expect(parseClaudeModels(native)).toEqual([
      expect.objectContaining({
        provider: "claude",
        id: "haiku",
        label: "Claude Haiku",
        input: ["text", "image"],
        metadata: { provider: "anthropic", modelId: "haiku" },
        defaultThinkingOptionId: "high",
      }),
    ]);
    expect(parseClaudeModels(native)[0]?.thinkingOptions).toContainEqual(
      expect.objectContaining({ id: "off" }),
    );
    expect(claudeModesForModels(native).map((mode) => mode.id)).toContain("auto");
  });

  it("adds target-configured aliases without replacing SDK metadata", () => {
    const models = parseClaudeModels(
      [{
        value: "opus[1m]",
        resolvedModel: "claude-opus-5[1m]",
        displayName: "Opus",
        description: "Capable",
      }],
      [
        { id: "opus[1m]", description: "duplicate" },
        {
          id: "openrouter/anthropic/custom",
          description: "From Claude settings.json env.ANTHROPIC_MODEL",
        },
      ],
    );
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: "opus[1m]",
      contextWindow: 1_000_000,
      metadata: { modelId: "claude-opus-5[1m]" },
    });
    expect(models[1]).toMatchObject({
      id: "openrouter/anthropic/custom",
      description: "From Claude settings.json env.ANTHROPIC_MODEL",
    });
  });

  it("falls back to approval modes when Auto is unavailable", () => {
    expect(
      claudeModesForModels([
        { value: "bedrock", displayName: "Bedrock", description: "Managed" },
      ]).map((mode) => mode.id),
    ).not.toContain("auto");
  });
});
