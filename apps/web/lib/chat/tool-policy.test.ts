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

  it("keeps provider-native tool choice invariant across runtime policy", () => {
    expect(
      resolveToolStepPolicy({
        runtimeContext: runtime(),
      }),
    ).toMatchObject({ allowedToolNames: [], toolChoice: "auto" });

    expect(
      resolveToolStepPolicy({
        runtimeContext: runtime(),
        toolNames: ["web_search", "fetch_url", "calculator"],
      }),
    ).toMatchObject({
      allowedToolNames: ["calculator"],
      toolChoice: "auto",
    });
  });

  it("tracks a search attempt without changing provider-native tool choice", () => {
    const before = runtime({ webSearchMode: "required" });
    expect(getAllowedToolNames(before, ["web_search", "fetch_url", "clock"]))
      .toEqual(["web_search"]);
    expect(
      resolveToolStepPolicy({
        runtimeContext: before,
      }).toolChoice,
    ).toBe("auto");

    const after = resolveToolStepPolicy({
      runtimeContext: before,
      webSearchAttempted: true,
      toolNames: ["web_search", "fetch_url", "clock"],
    });
    expect(after).toMatchObject({
      allowedToolNames: ["web_search", "fetch_url", "clock"],
      toolChoice: "auto",
      runtimeContext: { webSearchAttempted: true },
    });
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
      ),
    ).toEqual({
      openai: { reasoningEffort: "high" },
      custom: { temperatureHint: 2 },
    });
  });
});
