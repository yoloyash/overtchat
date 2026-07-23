import { describe, expect, it } from "vitest";
import { WEB_SEARCH_CITATION_PROMPT } from "./tools";

describe("WEB_SEARCH_CITATION_PROMPT", () => {
  it("documents every rendered citation form with literal markers", () => {
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("Web search:\n");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "Cite every non-obvious factual claim derived from web_search results",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn0search0");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain("\\ue202turn1search3");
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue202turn0search0\\ue202turn0search1",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue200\\ue202turn0search0\\ue202turn0search1\\ue201",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).toContain(
      "\\ue203Cited text.\\ue204\\ue202turn0search0",
    );
    expect(WEB_SEARCH_CITATION_PROMPT).not.toContain("\\ue202turn{");
    expect(WEB_SEARCH_CITATION_PROMPT).not.toMatch(/[\uE200-\uE204]/);
  });
});
