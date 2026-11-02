import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import mammoth from "mammoth";

vi.mock("server-only", () => ({}));

import { markdownToDocx } from "./docx";

async function convert(markdown: string) {
  const bytes = await markdownToDocx("Launch plan", markdown);
  const files = unzipSync(bytes);
  const xml = strFromU8(files["word/document.xml"]);
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return { bytes, files, xml, html };
}

describe("Markdown to Word", () => {
  it("produces a Word package with title metadata", async () => {
    const { bytes, files } = await convert("Hello");
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/numbering.xml", "docProps/core.xml"]),
    );
    expect(strFromU8(files["docProps/core.xml"])).toContain("<dc:title>Launch plan</dc:title>");
  });

  it("maps headings and inline formatting to Word styles", async () => {
    const { html, xml } = await convert(
      "# Launch plan\n\n## Timeline\n\nKickoff in **May**, beta *maybe* in ~~June~~ July with `npm run build`.\nSoft break joins.\n\nLine one  \nline two\n\n###### Deep",
    );
    expect(html).toContain("<h1>Launch plan</h1>");
    expect(html).toContain("<h2>Timeline</h2>");
    expect(html).toContain("<h6>Deep</h6>");
    expect(html).toContain("<strong>May</strong>");
    expect(html).toContain("<em>maybe</em>");
    expect(html).toContain("<s>June</s>");
    expect(html).toContain("July with npm run build. Soft break joins.");
    expect(html).toContain("Line one<br />line two");
    expect(xml).toContain('w:ascii="Courier New"');
  });

  it("keeps safe links and drops script links", async () => {
    const { html } = await convert(
      "See [the site](https://example.com/a?b=1) or [mail](mailto:a@b.co), not [this](javascript:alert(1)).",
    );
    expect(html).toContain('<a href="https://example.com/a?b=1">the site</a>');
    expect(html).toContain('<a href="mailto:a@b.co">mail</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("not this.");
  });

  it("writes nested bullet, numbered and task lists with restarted numbering", async () => {
    const { html, xml } = await convert(
      "- one\n  - nested\n- two\n\n1. first\n2. second\n\ntext\n\n1. again\n\n- [x] done\n- [ ] todo",
    );
    expect(html).toContain("<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<p>☑ done</p><p>☐ todo</p>");
    // Each ordered list has its own numbering instance, so the third starts at 1.
    const instances = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1]));
    expect(instances.size).toBeGreaterThanOrEqual(3);
  });

  it("renders tables with a bold header row and alignment", async () => {
    const { html, xml } = await convert(
      "| Phase | Month | Owner |\n|:--|:-:|--:|\n| Beta | July | Sam |\n| Launch | Sept |",
    );
    expect(html).toContain(
      "<table><thead><tr><th><p><strong>Phase</strong></p></th><th><p><strong>Month</strong></p></th><th><p><strong>Owner</strong></p></th></tr></thead><tbody><tr><td><p>Beta</p></td><td><p>July</p></td><td><p>Sam</p></td></tr><tr><td><p>Launch</p></td><td><p>Sept</p></td><td></td></tr></tbody></table>",
    );
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml.match(/<w:tblHeader/g)).toHaveLength(1);
  });

  it("keeps code blocks verbatim and quotes indented", async () => {
    const { html, xml } = await convert(
      "```ts\nconst a = 1;\n  indented();\n```\n\n> Quoted **text**\n> > deeper",
    );
    expect(html).toContain("const a = 1;<br />  indented();");
    expect(xml).toContain('w:fill="F2F2F2"');
    expect(html).toContain("Quoted <strong>text</strong>");
    expect([...xml.matchAll(/<w:ind w:left="(\d+)"\/>/g)].map((match) => match[1])).toEqual(
      expect.arrayContaining(["720", "1440"]),
    );
  });

  it("represents images, rules, raw HTML and footnotes as text", async () => {
    const { html } = await convert(
      "Logo: ![Company logo](https://example.com/logo.png)\n\n---\n\n<div>raw</div>\n\nClaim[^src].\n\n[^src]: Annual report.",
    );
    expect(html).toContain("<em>[Image: Company logo]</em>");
    expect(html).toContain("&lt;div&gt;raw&lt;/div&gt;");
    expect(html).toContain("Claim<sup>[1]</sup>.");
    expect(html).toContain("[1] Annual report.");
  });

  it("handles empty and very large documents", async () => {
    expect((await convert("")).html).toBe("");
    const big = Array.from({ length: 1_000 }, (_, i) => `Paragraph ${i} with some **bold** text.`).join("\n\n");
    const { html } = await convert(big);
    expect(html).toContain("Paragraph 999 with some <strong>bold</strong> text.");
  });
});
