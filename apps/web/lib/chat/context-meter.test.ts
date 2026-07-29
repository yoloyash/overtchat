import { describe, expect, it } from "vitest";
import {
  CONTEXT_METER_WARNING_PERCENT,
  DEFAULT_CONTEXT_METER_ENABLED,
  getContextMeterValues,
} from "./context-meter";

describe("getContextMeterValues", () => {
  it("calculates the displayed percentage and remaining tokens", () => {
    expect(getContextMeterValues(42_400, 100_000)).toEqual({
      usedTokens: 42_400,
      contextWindow: 100_000,
      percentage: 42,
      ringPercentage: 42.4,
      remainingTokens: 57_600,
      warning: false,
      critical: false,
    });
  });

  it("warns at the threshold", () => {
    const values = getContextMeterValues(
      CONTEXT_METER_WARNING_PERCENT,
      100,
    );

    expect(values.warning).toBe(true);
    expect(values.critical).toBe(false);
  });

  it("clamps the visual ring and remaining tokens when usage exceeds the limit", () => {
    expect(getContextMeterValues(125_000, 100_000)).toMatchObject({
      percentage: 125,
      ringPercentage: 100,
      remainingTokens: 0,
      warning: true,
      critical: true,
    });
  });

  it("keeps usage visible when the context limit is unknown", () => {
    expect(getContextMeterValues(12_345)).toEqual({
      usedTokens: 12_345,
      ringPercentage: 0,
      warning: false,
      critical: false,
    });
  });

  it("handles invalid values without producing negative progress", () => {
    expect(getContextMeterValues(-10, 0)).toEqual({
      usedTokens: 0,
      ringPercentage: 0,
      warning: false,
      critical: false,
    });
    expect(getContextMeterValues(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      usedTokens: 0,
      ringPercentage: 0,
      warning: false,
      critical: false,
    });
  });
});

describe("context meter preference", () => {
  it("defaults to enabled", () => {
    expect(DEFAULT_CONTEXT_METER_ENABLED).toBe(true);
  });
});
