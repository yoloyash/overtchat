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
  it("uses a detected toggle without sending an unsupported effort, preserving unrelated kwargs", () => {
    expect(
      applyLocalReasoningLevel(
        {
          reasoning_effort: "high",
          chat_template_kwargs: {
            thinking: true,
            custom: 1,
            reasoning_effort: "low",
          },
        },
        "off",
        { toggleParameter: "enable_thinking" },
      ),
    ).toEqual({ chat_template_kwargs: { custom: 1, enable_thinking: false } });
  });

  it("sends template effort using the configured mapping and leaves default untouched", () => {
    const body = {
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false, custom: 1 },
    };
    const mapping = {
      toggleParameter: "thinking",
      effortParameter: "chat_template_kwargs.reasoning_effort",
    } as const;
    expect(applyLocalReasoningLevel(body, "high", mapping)).toEqual({
      chat_template_kwargs: {
        custom: 1,
        thinking: true,
        reasoning_effort: "high",
      },
    });
    expect(applyLocalReasoningLevel(body, "default", mapping)).toBe(body);
  });
});
