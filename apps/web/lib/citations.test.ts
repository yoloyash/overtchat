import { describe, it, expect, beforeEach } from "vitest";
import {
  SPAN_REGEX,
  COMPOSITE_REGEX,
  STANDALONE_PATTERN,
  CLEANUP_REGEX,
  INVALID_CITATION_REGEX,
  buildWebCitationIndex,
  stripCitationMarkers,
} from "./citations";
import { unicodeCitation } from "./citations-remark";

describe("Citation Regex Patterns", () => {
  beforeEach(() => {
    SPAN_REGEX.lastIndex = 0;
    COMPOSITE_REGEX.lastIndex = 0;
    STANDALONE_PATTERN.lastIndex = 0;
    CLEANUP_REGEX.lastIndex = 0;
    INVALID_CITATION_REGEX.lastIndex = 0;
  });

  describe("STANDALONE_PATTERN", () => {
    describe("literal text format (\\ue202)", () => {
      it("should match literal text search citation", () => {
        const text = "Some fact \\ue202turn0search0 here";
        STANDALONE_PATTERN.lastIndex = 0;
        const match = STANDALONE_PATTERN.exec(text);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("0");
        expect(match?.[2]).toBe("search");
        expect(match?.[3]).toBe("0");
      });

      it("should match literal text file citation", () => {
        const text = "Document says \\ue202turn0file0 (doc.pdf)";
        STANDALONE_PATTERN.lastIndex = 0;
        const match = STANDALONE_PATTERN.exec(text);
        expect(match).not.toBeNull();
        expect(match?.[2]).toBe("file");
      });

      it("should match literal text news citation", () => {
        const text = "Breaking news \\ue202turn0news1";
        STANDALONE_PATTERN.lastIndex = 0;
        const match = STANDALONE_PATTERN.exec(text);
        expect(match?.[2]).toBe("news");
        expect(match?.[3]).toBe("1");
      });

      it("should match multiple literal text citations", () => {
        const text =
          "Fact one \\ue202turn0search0 and fact two \\ue202turn0file1";
        const matches: RegExpExecArray[] = [];
        let match: RegExpExecArray | null;
        STANDALONE_PATTERN.lastIndex = 0;
        while ((match = STANDALONE_PATTERN.exec(text)) !== null) {
          matches.push(match);
        }
        expect(matches).toHaveLength(2);
        expect(matches[0][2]).toBe("search");
        expect(matches[1][2]).toBe("file");
      });

      it("accepts the legacy brace form without exposing it as raw text", () => {
        const text = "Fact \\ue202turn0search{4}";
        STANDALONE_PATTERN.lastIndex = 0;
        const match = STANDALONE_PATTERN.exec(text);
        expect(match?.[1]).toBe("0");
        expect(match?.[2]).toBe("search");
        expect(match?.[3]).toBe("4");
      });

      it("should match all supported types in literal text format", () => {
        const types = ["search", "image", "news", "video", "ref", "file"];
        for (const type of types) {
          const text = `Test \\ue202turn0${type}0`;
          STANDALONE_PATTERN.lastIndex = 0;
          const match = STANDALONE_PATTERN.exec(text);
          expect(match).not.toBeNull();
          expect(match?.[2]).toBe(type);
        }
      });
    });

    describe("actual Unicode character format (U+E202)", () => {
      it("should match actual Unicode search citation", () => {
        const text = "Some fact turn0search0 here";
        STANDALONE_PATTERN.lastIndex = 0;
        const match = STANDALONE_PATTERN.exec(text);
        expect(match).not.toBeNull();
        expect(match?.[2]).toBe("search");
      });

      it("should match all supported types in actual Unicode format", () => {
        const types = ["search", "image", "news", "video", "ref", "file"];
        for (const type of types) {
          const text = `Test turn0${type}0`;
          STANDALONE_PATTERN.lastIndex = 0;
          const match = STANDALONE_PATTERN.exec(text);
          expect(match?.[2]).toBe(type);
        }
      });
    });

    describe("mixed format handling", () => {
      it("should match both formats in the same text", () => {
        const text = "Literal \\ue202turn0search0 and Unicode turn0file1";
        const matches: RegExpExecArray[] = [];
        let match: RegExpExecArray | null;
        STANDALONE_PATTERN.lastIndex = 0;
        while ((match = STANDALONE_PATTERN.exec(text)) !== null) {
          matches.push(match);
        }
        expect(matches).toHaveLength(2);
        expect(matches[0][2]).toBe("search");
        expect(matches[1][2]).toBe("file");
      });
    });
  });

  describe("SPAN_REGEX", () => {
    it("should match literal text span markers", () => {
      const text = "Before \\ue203highlighted text\\ue204 after";
      SPAN_REGEX.lastIndex = 0;
      const match = SPAN_REGEX.exec(text);
      expect(match?.[0]).toContain("highlighted text");
    });

    it("should match actual Unicode span markers", () => {
      const text = "Before highlighted text after";
      SPAN_REGEX.lastIndex = 0;
      const match = SPAN_REGEX.exec(text);
      expect(match?.[0]).toContain("highlighted text");
    });
  });

  describe("COMPOSITE_REGEX", () => {
    it("should match literal text composite markers", () => {
      const text =
        "Statement \\ue200\\ue202turn0search0\\ue202turn0news0\\ue201";
      COMPOSITE_REGEX.lastIndex = 0;
      expect(COMPOSITE_REGEX.exec(text)).not.toBeNull();
    });

    it("should match actual Unicode composite markers", () => {
      const text = "Statement turn0search0turn0news0";
      COMPOSITE_REGEX.lastIndex = 0;
      expect(COMPOSITE_REGEX.exec(text)).not.toBeNull();
    });
  });

  describe("CLEANUP_REGEX", () => {
    it("should clean up literal text markers", () => {
      const text = "\\ue200\\ue201\\ue202\\ue203\\ue204\\ue206";
      expect(text.replace(CLEANUP_REGEX, "")).toBe("");
    });

    it("should clean up actual Unicode markers", () => {
      const text = "";
      expect(text.replace(CLEANUP_REGEX, "")).toBe("");
    });

    it("should preserve normal text while cleaning markers", () => {
      const text = "Hello \\ue202turn0search0 world";
      expect(text.replace(CLEANUP_REGEX, "")).toBe("Hello turn0search0 world");
    });
  });

  describe("INVALID_CITATION_REGEX", () => {
    it("should match invalid literal text citations with leading whitespace", () => {
      const text = "Text  \\ue202turn0search5";
      INVALID_CITATION_REGEX.lastIndex = 0;
      expect(INVALID_CITATION_REGEX.exec(text)).not.toBeNull();
    });

    it("should match invalid actual Unicode citations with leading whitespace", () => {
      const text = "Text  turn0search5";
      INVALID_CITATION_REGEX.lastIndex = 0;
      expect(INVALID_CITATION_REGEX.exec(text)).not.toBeNull();
    });
  });

  describe("stripCitationMarkers (clipboard helper)", () => {
    it("removes both literal and unicode markers in a realistic blob", () => {
      const text =
        "Finding A \\ue202turn0search0. Quoted line. turn0news0 More context \\ue200\\ue202turn0file0\\ue202turn0file1\\ue201.";
      const cleaned = stripCitationMarkers(text);
      expect(cleaned).not.toContain("\\ue202");
      expect(cleaned).not.toContain("");
      expect(cleaned).not.toContain("turn0search0");
      expect(cleaned).toContain("Finding A");
      expect(cleaned).toContain("Quoted line.");
    });

    it("removes legacy brace-form citations", () => {
      expect(stripCitationMarkers("Fact. \\ue202turn0search{4}")).toBe("Fact.");
    });
  });

  describe("citation rendering", () => {
    it("turns a legacy brace-form marker into a citation node", () => {
      const tree = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Fact. \\ue202turn0search{4}" }],
          },
        ],
      };

      unicodeCitation()(tree);

      expect(tree.children[0].children).toMatchObject([
        { type: "text", value: "Fact. " },
        {
          type: "citation",
          data: {
            hProperties: { turn: 0, reftype: "search", index: 4 },
          },
        },
      ]);
    });
  });

  describe("buildWebCitationIndex", () => {
    const sourceA = { link: "https://a.example/", title: "A", snippet: "a" };
    const sourceB = { link: "https://b.example/", title: "B", snippet: "b" };
    const sourceC = { link: "https://c.example/", title: "C", snippet: "c" };

    it("resolves the search call and local result index independently", () => {
      const index = buildWebCitationIndex([
        {
          type: "tool-web_search",
          toolCallId: "search-0",
          state: "output-available",
          output: [sourceA, sourceB],
        },
        { type: "tool-fetch_url", output: {} },
        {
          type: "tool-web_search",
          toolCallId: "search-1",
          state: "output-available",
          output: [sourceB, sourceC],
        },
      ]);

      expect(index.sources).toEqual([sourceA, sourceB, sourceC]);
      expect(index.resolve(0, "search", 1)).toEqual({
        source: sourceB,
        number: 2,
      });
      expect(index.resolve(1, "search", 0)).toEqual({
        source: sourceB,
        number: 2,
      });
      expect(index.resolve(1, "search", 1)).toEqual({
        source: sourceC,
        number: 3,
      });
    });

    it("counts failed web searches when assigning turn coordinates", () => {
      const index = buildWebCitationIndex([
        {
          type: "tool-web_search",
          toolCallId: "failed-search",
          state: "output-error",
        },
        {
          type: "tool-web_search",
          toolCallId: "search-1",
          state: "output-available",
          output: [sourceA],
        },
      ]);

      expect(index.resolve(1, "search", 0)).toEqual({
        source: sourceA,
        number: 1,
      });
    });

    it("falls back to legacy flattened result indexes", () => {
      const index = buildWebCitationIndex([
        {
          type: "tool-web_search",
          toolCallId: "search-0",
          state: "output-available",
          output: [sourceA, sourceB],
        },
        {
          type: "tool-web_search",
          toolCallId: "search-1",
          state: "output-available",
          output: [sourceC],
        },
      ]);

      expect(index.resolve(0, "search", 2)).toEqual({
        source: sourceC,
        number: 3,
      });
      expect(index.resolve(0, "image", 0)).toBeUndefined();
    });
  });
});
