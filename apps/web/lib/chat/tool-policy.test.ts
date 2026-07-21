import { describe, expect, it } from "vitest";
import type { ChatRuntimeContext } from "@/lib/runtime-context";
import { CHAT_TOOL_NAMES, CHAT_TOOL_ORDER, chatTools } from "@/lib/tools";
import { getToolApprovalStatus } from "./tool-policy";

function runtime(
  overrides: Partial<ChatRuntimeContext> = {},
): ChatRuntimeContext {
  return {
    currentDateTime: "Sunday, July 19, 2026 at 4:42:18 PM PDT",
    timeZone: "America/Los_Angeles",
    webSearchMode: "disabled",
    ...overrides,
  };
}

describe("chat tool policy", () => {
  it("derives policy names and serialization order from the full registry", () => {
    expect(CHAT_TOOL_NAMES).toEqual(Object.keys(chatTools));
    expect(CHAT_TOOL_ORDER).toEqual(Object.keys(chatTools));
  });

  it("denies disabled web tools with an explicit reason", () => {
    expect(getToolApprovalStatus("web_search", runtime())).toEqual({
      type: "denied",
      reason: "Web tools are disabled by the user for this turn.",
    });
    expect(getToolApprovalStatus("fetch_url", runtime())).toEqual({
      type: "denied",
      reason: "Web tools are disabled by the user for this turn.",
    });
  });

  it("denies unavailable web tools with an explicit reason", () => {
    const unavailable = runtime({ webSearchMode: "unavailable" });
    expect(getToolApprovalStatus("web_search", unavailable)).toEqual({
      type: "denied",
      reason: "Web tools are unavailable for the selected model.",
    });
    expect(getToolApprovalStatus("fetch_url", unavailable)).toEqual({
      type: "denied",
      reason: "Web tools are unavailable for the selected model.",
    });
  });

  it("allows either web tool first when web access is enabled", () => {
    const enabled = runtime({ webSearchMode: "enabled" });
    expect(getToolApprovalStatus("web_search", enabled)).toEqual({
      type: "not-applicable",
    });
    expect(getToolApprovalStatus("fetch_url", enabled)).toEqual({
      type: "not-applicable",
    });
  });

  it("leaves future non-web tools independent from the web toggle", () => {
    expect(getToolApprovalStatus("calculator", runtime())).toEqual({
      type: "not-applicable",
    });
  });
});
