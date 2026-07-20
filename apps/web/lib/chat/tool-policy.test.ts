import { describe, expect, it } from "vitest";
import type { ChatRuntimeContext } from "@/lib/runtime-context";
import { CHAT_TOOL_NAMES, CHAT_TOOL_ORDER, chatTools } from "@/lib/tools";
import {
  getAllowedToolNames,
  getToolApprovalStatus,
  resolveToolStepPolicy,
  sanitizeToolProviderOptions,
} from "./tool-policy";

function runtime(
  overrides: Partial<ChatRuntimeContext> = {},
): ChatRuntimeContext {
  return {
    currentTurn: 1,
    currentDateTime: "Sunday, July 19, 2026 at 4:42:18 PM PDT",
    timeZone: "America/Los_Angeles",
    webSearchMode: "disabled",
    webSearchAttempted: false,
    ...overrides,
  };
}

describe("chat tool policy", () => {
  it("derives policy names and serialization order from the full registry", () => {
    expect(CHAT_TOOL_NAMES).toEqual(Object.keys(chatTools));
    expect(CHAT_TOOL_ORDER).toEqual(Object.keys(chatTools));
  });

  it("uses none only when every registered tool is disallowed", () => {
    expect(
      resolveToolStepPolicy({
        runtimeContext: runtime(),
        strategy: "tool-choice",
      }),
    ).toMatchObject({ allowedToolNames: [], toolChoice: "none" });

    expect(
      resolveToolStepPolicy({
        runtimeContext: runtime(),
        strategy: "tool-choice",
        toolNames: ["web_search", "fetch_url", "calculator"],
      }),
    ).toMatchObject({
      allowedToolNames: ["calculator"],
      toolChoice: "auto",
    });
  });

  it("keeps definitions visible when a provider emulates none by hiding tools", () => {
    expect(
      resolveToolStepPolicy({
        runtimeContext: runtime(),
        strategy: "approval-only",
      }),
    ).toMatchObject({ allowedToolNames: [], toolChoice: "auto" });
  });

  it("forces a search attempt before exposing the rest of the registry", () => {
    const before = runtime({ webSearchMode: "required" });
    expect(getAllowedToolNames(before, ["web_search", "fetch_url", "clock"]))
      .toEqual(["web_search"]);
    expect(
      resolveToolStepPolicy({
        runtimeContext: before,
        strategy: "tool-choice",
      }).toolChoice,
    ).toBe("required");

    const after = resolveToolStepPolicy({
      runtimeContext: before,
      webSearchAttempted: true,
      strategy: "tool-choice",
      toolNames: ["web_search", "fetch_url", "clock"],
    });
    expect(after).toMatchObject({
      allowedToolNames: ["web_search", "fetch_url", "clock"],
      toolChoice: "auto",
      runtimeContext: { webSearchAttempted: true },
    });
  });

  it("uses OpenAI allowed_tools without changing the full tool registry", () => {
    const policy = resolveToolStepPolicy({
      runtimeContext: runtime({ webSearchMode: "required" }),
      strategy: "openai-allowed-tools",
    });

    expect(policy.providerOptions).toEqual({
      openai: {
        allowedTools: { toolNames: ["web_search"], mode: "required" },
      },
    });
    expect(policy.toolChoice).toBe("required");
  });

  it("denies disabled and out-of-sequence calls with an explicit reason", () => {
    expect(getToolApprovalStatus("web_search", runtime())).toEqual({
      type: "denied",
      reason: "Web search is disabled by the user for this turn.",
    });
    expect(
      getToolApprovalStatus(
        "fetch_url",
        runtime({ webSearchMode: "required" }),
      ),
    ).toEqual({
      type: "denied",
      reason: "web_search must run before other tools for this turn.",
    });
    expect(getToolApprovalStatus("calculator", runtime())).toEqual({
      type: "not-applicable",
    });
  });

  it("removes saved OpenAI allowedTools while preserving unrelated options", () => {
    expect(
      sanitizeToolProviderOptions(
        {
          openai: {
            reasoningEffort: "high",
            allowedTools: { toolNames: ["stale"] },
          },
          custom: { temperatureHint: 2 },
        },
        "openai-allowed-tools",
      ),
    ).toEqual({
      openai: { reasoningEffort: "high" },
      custom: { temperatureHint: 2 },
    });
  });
});
