import { describe, expect, it } from "vitest";
import { isToolSettled } from "@overtchat/shared";

describe("AI SDK tool state", () => {
  it("recognizes successful and failed terminal states", () => {
    expect(isToolSettled({ state: "output-available" })).toBe(true);
    expect(isToolSettled({ state: "output-error" })).toBe(true);
  });

  it("keeps input states active", () => {
    expect(isToolSettled({ state: "input-streaming" })).toBe(false);
    expect(isToolSettled({ state: "input-available" })).toBe(false);
  });
});
