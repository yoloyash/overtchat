import type { AgentProviderCatalog } from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import {
  AGENT_MODEL_DEFAULTS_LOADING_MESSAGE,
  agentSessionDraftRestoreKey,
  resolveAgentSessionDraftSelection,
  resolveAgentSessionThinking,
} from "./sessionDraft";

const catalog: AgentProviderCatalog = {
  provider: "codex",
  models: [
    {
      provider: "codex",
      id: "first",
      label: "First",
      api: "openai-responses",
      baseUrl: "",
      reasoning: true,
      input: ["text"],
      contextWindow: null,
      maxTokens: null,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
    {
      provider: "codex",
      id: "default",
      label: "Default",
      isDefault: true,
      api: "openai-responses",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      contextWindow: null,
      maxTokens: null,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
  modes: [
    { id: "auto", label: "Auto", description: "Ask when needed" },
    { id: "full", label: "Full", description: "No prompts", dangerous: true },
  ],
  defaultModeId: "auto",
};

describe("agent session draft", () => {
  it("uses the visible submission gate copy", () => {
    expect(AGENT_MODEL_DEFAULTS_LOADING_MESSAGE).toBe(
      "Model defaults are still loading",
    );
  });

  it("builds a stable restore key", () => {
    expect(agentSessionDraftRestoreKey("session-1")).toBe(
      "overtchat:agent-fork-draft:session-1",
    );
  });

  it("restores valid provider preferences over catalog defaults", () => {
    const selection = resolveAgentSessionDraftSelection({
      provider: "codex",
      catalog,
      preferences: {
        model: "first",
        mode: "full",
        thinkingByModel: { first: "low" },
      },
      modelId: "",
      thinkingOptionId: "",
      modeId: "",
    });

    expect(selection.model?.id).toBe("first");
    expect(selection.thinkingOptionId).toBe("low");
    expect(selection.modeId).toBe("full");
  });

  it("uses catalog defaults when preferences are stale", () => {
    const selection = resolveAgentSessionDraftSelection({
      provider: "codex",
      catalog,
      preferences: { model: "removed", mode: "removed" },
      modelId: "",
      thinkingOptionId: "",
      modeId: "",
    });

    expect(selection.model?.id).toBe("default");
    expect(selection.thinkingOptionId).toBe("");
    expect(selection.modeId).toBe("auto");
  });

  it("exposes OMP permissions before its model catalog loads", () => {
    const selection = resolveAgentSessionDraftSelection({
      provider: "omp",
      preferences: { mode: "write" },
      modelId: "",
      thinkingOptionId: "",
      modeId: "",
    });

    expect(selection.model).toBeNull();
    expect(selection.modes.map((mode) => mode.id)).toEqual([
      "full",
      "write",
      "ask",
    ]);
    expect(selection.modeId).toBe("write");
  });
});

describe("resolveAgentSessionThinking", () => {
  const [reasoning, plain] = catalog.models;

  it("keeps the level the provider reports when the model offers it", () => {
    expect(resolveAgentSessionThinking(reasoning, "low")).toBe("low");
  });

  it("shows the model's default when the provider reports no level", () => {
    expect(resolveAgentSessionThinking(reasoning, undefined)).toBe("high");
    expect(
      resolveAgentSessionThinking(
        { ...reasoning, defaultThinkingOptionId: "low" },
        null,
      ),
    ).toBe("low");
  });

  it("shows the model's default when it does not offer the reported level", () => {
    expect(resolveAgentSessionThinking(reasoning, "xhigh")).toBe("high");
  });

  it("falls back to the first option when the model marks no default", () => {
    expect(
      resolveAgentSessionThinking(
        {
          ...reasoning,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        },
        undefined,
      ),
    ).toBe("low");
  });

  it("has no level for a model without effort options", () => {
    expect(resolveAgentSessionThinking(plain, "high")).toBeNull();
    expect(resolveAgentSessionThinking(undefined, "high")).toBeNull();
  });
});
