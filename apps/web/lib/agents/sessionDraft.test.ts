import type { AgentProviderCatalog } from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import {
  AGENT_MODEL_DEFAULTS_LOADING_MESSAGE,
  agentSessionDraftRestoreKey,
  newAgentSessionHref,
  resolveAgentSessionDraftSelection,
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

  it("builds an encoded draft URL and stable restore key", () => {
    expect(newAgentSessionHref("workspace / one", "codex")).toBe(
      "/agents/new?workspaceId=workspace+%2F+one&provider=codex",
    );
    expect(agentSessionDraftRestoreKey("session-1")).toBe(
      "overtchat:agent-fork-draft:session-1",
    );
  });

  it("ignores remembered Codex choices so new chats use configured defaults", () => {
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

    expect(selection.model?.id).toBe("default");
    expect(selection.thinkingOptionId).toBe("");
    expect(selection.modeId).toBe("auto");
    expect(selection.launchConfig).toEqual({});
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

  it("sends only explicit Codex settings, including fork selections", () => {
    const selection = resolveAgentSessionDraftSelection({
      provider: "codex", catalog, modelId: "first", thinkingOptionId: "", modeId: "",
    });
    expect(selection.model?.id).toBe("first");
    expect(selection.thinkingOptionId).toBe("high");
    expect(selection.launchConfig).toEqual({ model: "first" });
    expect(resolveAgentSessionDraftSelection({
      provider: "codex", catalog, modelId: "", thinkingOptionId: "high", modeId: "full",
    }).launchConfig).toEqual({ thinkingOptionId: "high", modeId: "full" });
  });

  it("retains remembered choices for other providers", () => {
    const selection = resolveAgentSessionDraftSelection({
      provider: "pi",
      catalog: { ...catalog, provider: "pi", models: catalog.models.map((model) => ({ ...model, provider: "pi" })) },
      preferences: { model: "first", mode: "full", thinkingByModel: { first: "low" } },
      modelId: "", thinkingOptionId: "", modeId: "",
    });
    expect(selection.launchConfig).toEqual({ model: "first", thinkingOptionId: "low", modeId: "full" });
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
