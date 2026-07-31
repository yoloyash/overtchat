import { describe, expect, it } from "vitest";
import { formatNanoUsd, getCostCoverage } from "./cost";

describe("session cost formatting", () => {
  it("matches Pi's terse three-decimal session format", () => {
    expect(formatNanoUsd(0)).toBe("$0.000");
    expect(formatNanoUsd(55_900_000)).toBe("$0.056");
    expect(formatNanoUsd(1_500_000_000)).toBe("$1.500");
  });

  it("distinguishes complete, partial, and unavailable pricing", () => {
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 2 }),
    ).toBe("complete");
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 1 }),
    ).toBe("partial");
    expect(
      getCostCoverage({ generations: 2, pricedGenerations: 0 }),
    ).toBe("unavailable");
  });
});
