import { describe, expect, it } from "vitest";
import { currentDateSystemPrompt, normalizeTimeZone } from "./current-date";

describe("current date system metadata", () => {
  it("formats only the local calendar date and IANA time zone", () => {
    expect(
      currentDateSystemPrompt(
        "America/Los_Angeles",
        new Date("2026-07-22T06:59:00.000Z"),
      ),
    ).toBe("Current date: 2026-07-21 (America/Los_Angeles).");

    expect(
      currentDateSystemPrompt(
        "America/Los_Angeles",
        new Date("2026-07-22T07:00:00.000Z"),
      ),
    ).toBe("Current date: 2026-07-22 (America/Los_Angeles).");
  });

  it("falls back to UTC for missing or invalid time zones", () => {
    const now = new Date("2026-07-22T23:30:00.000Z");

    expect(normalizeTimeZone()).toBe("UTC");
    expect(normalizeTimeZone("not/a-time-zone")).toBe("UTC");
    expect(currentDateSystemPrompt(undefined, now)).toBe(
      "Current date: 2026-07-22 (UTC).",
    );
    expect(currentDateSystemPrompt("not/a-time-zone", now)).toBe(
      "Current date: 2026-07-22 (UTC).",
    );
  });

  it("canonicalizes accepted time zone aliases", () => {
    expect(normalizeTimeZone("  US/Pacific  ")).toBe("America/Los_Angeles");
  });
});
