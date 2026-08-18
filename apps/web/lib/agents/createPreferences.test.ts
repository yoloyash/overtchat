import { describe, expect, it } from "vitest";

import {
  mergeAgentProviderPreferences,
  parseAgentCreatePreferences,
} from "./createPreferences";

describe("agent create preferences", () => {
  it("keeps model-specific reasoning choices when another model changes", () => {
    const first = mergeAgentProviderPreferences({
      preferences: {},
      provider: "omp",
      updates: {
        model: "openai/gpt-5",
        thinkingByModel: { "openai/gpt-5": "high" },
      },
    });

    expect(
      mergeAgentProviderPreferences({
        preferences: first,
        provider: "omp",
        updates: {
          model: "anthropic/claude",
          thinkingByModel: { "anthropic/claude": "medium" },
        },
      }),
    ).toEqual({
      providerPreferences: {
        omp: {
          model: "anthropic/claude",
          thinkingByModel: {
            "openai/gpt-5": "high",
            "anthropic/claude": "medium",
          },
        },
      },
    });
  });

  it("rejects malformed stored preference payloads", () => {
    expect(
      parseAgentCreatePreferences({
        providerPreferences: { omp: { mode: 42 } },
      }),
    ).toEqual({});
  });
});
