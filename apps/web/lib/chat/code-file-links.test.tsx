import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { describe, expect, it } from "vitest";
import {
  codeExecutionFileIndex,
  codeFileLinkName,
  type CodeExecutionFile,
  type CodeExecutionPart,
} from "@overtchat/shared";
import { CodeFileLink, CodeFilesProvider } from "@/components/chat/CodeExecutionFiles";
import { CODE_FILE_ALLOWED_TAGS, CODE_FILE_TAG, codeFileLinks } from "./code-file-links";

const chart: CodeExecutionFile = {
  id: "chart",
  url: "/api/uploads/chart",
  name: "Chart.png",
  mediaType: "image/png",
  size: 2048,
};
const table: CodeExecutionFile = {
  id: "table",
  url: "/api/uploads/table",
  name: "totals (2).csv",
  mediaType: "text/csv",
  size: 40,
};

function run(files: CodeExecutionFile[]): CodeExecutionPart {
  return {
    type: "tool-run_python",
    toolCallId: "call",
    state: "output-available",
    input: { code: "1" },
    output: { exitCode: 0, timedOut: false, durationMs: 10, stdout: "", stderr: "", files },
  };
}

const files = codeExecutionFileIndex([{ parts: [run([chart]), { type: "text" }] }, { parts: [run([table])] }]);

function render(markdown: string) {
  return parseHTML(
    renderToStaticMarkup(
      <CodeFilesProvider value={files}>
        <Streamdown
          mode="static"
          remarkPlugins={[...Object.values(defaultRemarkPlugins), codeFileLinks]}
          allowedTags={CODE_FILE_ALLOWED_TAGS}
          components={{
            [CODE_FILE_TAG]: (props: Record<string, unknown>) => (
              <CodeFileLink
                filename={props.filename as string | undefined}
                embed={props.embed as string | undefined}
              >
                {props.children as React.ReactNode}
              </CodeFileLink>
            ),
          }}
        >
          {markdown}
        </Streamdown>
      </CodeFilesProvider>,
    ),
  ).document;
}

describe("code file links", () => {
  it("reads the file name from the paths models write", () => {
    expect(codeFileLinkName("chart.png")).toBe("chart.png");
    expect(codeFileLinkName("./outputs/chart.png")).toBe("chart.png");
    expect(codeFileLinkName("/mnt/data/outputs/chart.png")).toBe("chart.png");
    expect(codeFileLinkName("sandbox:/mnt/data/outputs/totals%20(2).csv")).toBe("totals (2).csv");
    expect(codeFileLinkName("totals (2).csv")).toBe("totals (2).csv");
    expect(codeFileLinkName("100%.csv")).toBe("100%.csv");
    for (const target of ["https://example.com/chart.png", "mailto:a@b.c", "#totals", "?q=1", "//cdn/chart.png", "/api/uploads/chart", ""]) {
      expect(codeFileLinkName(target)).toBeNull();
    }
  });

  it("indexes every run's files by name across the conversation", () => {
    expect([...files.keys()]).toEqual(["chart.png", "totals (2).csv"]);
    const failed: CodeExecutionPart = { ...run([chart]), state: "output-error" };
    expect(codeExecutionFileIndex([{ parts: [failed] }]).size).toBe(0);
  });

  it("shows an image or a card where the reply links a file on its own line", () => {
    const document = render(
      "North leads.\n\n![Totals](sandbox:/mnt/data/outputs/chart.png)\n\n[Download](totals%20(2).csv)",
    );
    const image = document.querySelector("[data-code-file-image] img");
    expect(image?.getAttribute("src")).toBe("/api/uploads/chart");
    expect(image?.getAttribute("alt")).toBe("Chart.png");
    const card = document.querySelector("[data-code-file-card]");
    expect(card?.getAttribute("href")).toBe("/api/uploads/table");
    expect(card?.getAttribute("download")).toBe("totals (2).csv");
    expect(card?.textContent).toContain("CSV · 40 B");
  });

  it("keeps a link inside a sentence a link, and drops targets no run returned", () => {
    const document = render(
      "See [the table](</mnt/data/outputs/totals (2).csv>) and [missing](gone.csv), or [the docs](https://example.com/a.csv).",
    );
    const links = [...document.querySelectorAll("a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["the table", "/api/uploads/table"],
    ]);
    expect(document.querySelector("[data-code-file-card]")).toBeNull();
    // Web links keep Streamdown's own link handling.
    expect(document.querySelector("[data-streamdown=link]")?.textContent).toBe("the docs");
    expect(document.querySelector("p")?.textContent).toContain("and missing, or");
  });

  it("embeds each file of a line that only links files", () => {
    const document = render("[chart](Chart.png) [table](totals%20(2).csv)\n\n- [table](totals%20(2).csv)");
    expect(document.querySelectorAll("[data-code-file-image]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-code-file-card]")).toHaveLength(2);
  });
});
