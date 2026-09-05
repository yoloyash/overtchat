import { describe, expect, it } from "vitest";
import { applyLocalReasoningLevel } from "./local-reasoning";

describe("applyLocalReasoningLevel", () => {
  it("leaves manual parameters untouched for the default selection", () => {
    const body = {
      reasoning_effort: "high",
      chat_template_kwargs: { enable_thinking: false, custom: "value" },
    };
    expect(applyLocalReasoningLevel(body, "default")).toBe(body);
  });

  it("turns thinking off and overrides only conflicting native controls", () => {
    expect(
      applyLocalReasoningLevel(
        {
          temperature: 0.5,
          reasoning_effort: "high",
          chat_template_kwargs: { enable_thinking: true, custom: "value" },
        },
        "off",
      ),
    ).toEqual({
      temperature: 0.5,
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false, custom: "value" },
    });
  });

  it("sends the selected effort through both local runtime controls", () => {
    expect(applyLocalReasoningLevel({ stream: true }, "xhigh")).toEqual({
      stream: true,
      reasoning_effort: "xhigh",
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it("explicitly enables template thinking without inventing an effort", () => {
    expect(
      applyLocalReasoningLevel(
        { reasoning_effort: "none", chat_template_kwargs: { custom: true } },
        "on",
      ),
    ).toEqual({
      reasoning_effort: undefined,
      chat_template_kwargs: { custom: true, enable_thinking: true },
    });
  });
});
