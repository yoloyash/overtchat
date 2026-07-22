import { describe, expect, it } from "vitest";
import { WEB_SEARCH_CITATION_PROMPT } from "./tools";

describe("WEB_SEARCH_CITATION_PROMPT", () => {
  it("shows exact turn-local citation examples without template braces", () => {
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn0search0");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn1search3");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("without braces");
    expect(WEB_SEARCH_CITATION_PROMPT).not.toContain("search{index}");
  });
});
