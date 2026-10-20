import { describe, expect, it } from "vitest";
import { catalogReasoningControlsFor } from "./model-catalog-reasoning";

describe("catalog reasoning controls", () => {
  it("copies OpenAI effort values and treats none as an off control", () => {
    expect(
      catalogReasoningControlsFor("openai", [
        {
          type: "effort",
          values: ["none", "low", "medium", "high", "xhigh"],
        },
      ]),
    ).toEqual({
      toggle: true,
      defaultLevel: "medium",
      efforts: ["low", "medium", "high", "xhigh"],
    });
  });

  it("uses provider defaults without remapping effort names", () => {
    expect(
      catalogReasoningControlsFor("anthropic", [
        {
          type: "effort",
          values: ["low", "medium", "high", "xhigh", "max"],
        },
      ]),
    ).toEqual({
      toggle: false,
      defaultLevel: "high",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(
      catalogReasoningControlsFor("google", [
        { type: "effort", values: ["minimal", "low", "medium", "high"] },
      ]),
    ).toEqual({
      toggle: false,
      defaultLevel: "high",
      efforts: ["minimal", "low", "medium", "high"],
    });
    expect(
      catalogReasoningControlsFor("deepseek", [
        { type: "toggle" },
        { type: "effort", values: ["low", "high", "max"] },
      ]),
    ).toEqual({
      toggle: true,
      defaultLevel: "max",
      efforts: ["low", "high", "max"],
    });
  });

  it("uses a fixed model's only effort as its concrete default", () => {
    expect(
      catalogReasoningControlsFor("openai", [
        { type: "effort", values: ["high"] },
      ]),
    ).toEqual({
      toggle: false,
      defaultLevel: "high",
      efforts: ["high"],
    });
  });

  it("fails closed for budget, toggle-only, unknown, and ambiguous metadata", () => {
    expect(
      catalogReasoningControlsFor("anthropic", [
        { type: "effort", values: ["low", "medium", "high"] },
        { type: "budget_tokens", min: 1024 },
      ]),
    ).toBeUndefined();
    expect(
      catalogReasoningControlsFor("google", [{ type: "toggle" }]),
    ).toBeUndefined();
    expect(
      catalogReasoningControlsFor("bedrock", [
        { type: "effort", values: ["low", "medium", "high"] },
      ]),
    ).toBeUndefined();
    expect(
      catalogReasoningControlsFor("openai", [
        { type: "effort", values: ["low", "high", "default", null] },
      ]),
    ).toBeUndefined();
  });
});
