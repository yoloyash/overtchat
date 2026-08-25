import { describe, expect, it } from "vitest";
import {
  deriveInitialAgentSessionTitle,
  resolveInitialAgentSessionTitle,
} from "./sessionTitle";

describe("agent session titles", () => {
  it("uses the first non-empty prompt line and normalizes whitespace", () => {
    expect(
      deriveInitialAgentSessionTitle(
        "\n  Investigate   the\tbroken session titles  \nMore context",
      ),
    ).toBe("Investigate the broken session titles");
  });

  it("caps prompt-derived titles at 60 characters", () => {
    expect(deriveInitialAgentSessionTitle("a".repeat(80))).toBe(
      "a".repeat(60),
    );
  });

  it("returns null for a prompt without content", () => {
    expect(deriveInitialAgentSessionTitle(" \n\t\n ")).toBeNull();
  });

  it("prefers an explicit or provider-supplied initial name", () => {
    expect(
      resolveInitialAgentSessionTitle({
        name: "  Release prep  ",
        firstMessage: "Inspect the release",
      }),
    ).toBe("Release prep");
  });

  it("falls back to the first message when no name exists", () => {
    expect(
      resolveInitialAgentSessionTitle({
        name: null,
        firstMessage: "Review this repository\nBe thorough",
      }),
    ).toBe("Review this repository");
  });
});
