import { describe, expect, it } from "vitest";
import { formatNanoUsd, getCostCoverage } from "./cost";

describe("session cost formatting", () => {
  it("keeps small estimates visible without noisy precision", () => {
    expect(formatNanoUsd(0)).toBe("$0.00");
    expect(formatNanoUsd(1)).toBe("<$0.000001");
    expect(formatNanoUsd(153_700)).toBe("$0.000154");
    expect(formatNanoUsd(12_345_678)).toBe("$0.0123");
    expect(formatNanoUsd(1_500_000_000)).toBe("$1.50");
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
