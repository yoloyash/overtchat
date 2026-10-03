import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { extractSearchText } from "./extract";

describe("continued answer indexing", () => {
  it("keeps a word split across continuation requests searchable as one word", () => {
    expect(extractSearchText([
      { type: "text", text: "An inter" },
      { type: "step-start" },
      { type: "text", text: "rupted answer" },
    ])).toBe("An interrupted answer");
  });
});
