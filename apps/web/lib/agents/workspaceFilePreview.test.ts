import { describe, expect, it } from "vitest";
import {
  remarkWorkspaceFileLinks,
  resolveWorkspaceFileLink,
  workspaceFileRendering,
} from "./workspaceFilePreview";

describe("workspaceFileRendering", () => {
  it("offers a rendered view for documents, tables, pages and drawings", () => {
    expect(workspaceFileRendering("README.md")).toEqual({ kind: "markdown" });
    expect(workspaceFileRendering("docs/Guide.MARKDOWN")).toEqual({
      kind: "markdown",
    });
    expect(workspaceFileRendering("data/rows.csv")).toEqual({
      kind: "table",
      delimiter: ",",
    });
    expect(workspaceFileRendering("data/rows.tsv")).toEqual({
      kind: "table",
      delimiter: "\t",
    });
    expect(workspaceFileRendering("report.html")).toEqual({ kind: "html" });
    expect(workspaceFileRendering("logo.svg")).toEqual({ kind: "svg" });
  });

  it("leaves code and extensionless files as source", () => {
    expect(workspaceFileRendering("src/index.ts")).toBeNull();
    expect(workspaceFileRendering("page.mdx")).toBeNull();
    expect(workspaceFileRendering("Makefile")).toBeNull();
    expect(workspaceFileRendering("docs/.md")).toBeNull();
    expect(workspaceFileRendering("notes.md/readme")).toBeNull();
  });
});

describe("resolveWorkspaceFileLink", () => {
  it("resolves links against the file's directory", () => {
    expect(resolveWorkspaceFileLink("README.md", "docs/setup.md")).toBe(
      "docs/setup.md",
    );
    expect(resolveWorkspaceFileLink("docs/guide.md", "./setup.md")).toBe(
      "docs/setup.md",
    );
    expect(resolveWorkspaceFileLink("docs/a/guide.md", "../../src/app.ts")).toBe(
      "src/app.ts",
    );
  });

  it("treats a leading slash as the workspace root", () => {
    expect(resolveWorkspaceFileLink("docs/guide.md", "/src/app.ts")).toBe(
      "src/app.ts",
    );
  });

  it("drops fragments and queries and decodes escapes", () => {
    expect(resolveWorkspaceFileLink("README.md", "docs/setup.md#install")).toBe(
      "docs/setup.md",
    );
    expect(resolveWorkspaceFileLink("README.md", "my%20notes.md?raw=1")).toBe(
      "my notes.md",
    );
  });

  it("ignores links that are not workspace files", () => {
    expect(resolveWorkspaceFileLink("README.md", "https://example.com")).toBeNull();
    expect(resolveWorkspaceFileLink("README.md", "mailto:a@example.com")).toBeNull();
    expect(resolveWorkspaceFileLink("README.md", "//example.com/a")).toBeNull();
    expect(resolveWorkspaceFileLink("README.md", "#install")).toBeNull();
    expect(resolveWorkspaceFileLink("README.md", "../outside.md")).toBeNull();
    expect(resolveWorkspaceFileLink("docs/guide.md", "..")).toBeNull();
  });
});

describe("remarkWorkspaceFileLinks", () => {
  it("marks workspace links and leaves the rest alone", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "link", url: "setup.md", children: [] },
            { type: "link", url: "https://example.com", children: [] },
          ],
        },
      ],
    };
    remarkWorkspaceFileLinks("docs/guide.md")()(tree);
    const [internal, external] = tree.children[0].children as Array<{
      data?: unknown;
    }>;
    expect(internal.data).toEqual({
      hName: "agent-workspace-link",
      hProperties: { path: "docs/setup.md" },
    });
    expect(external.data).toBeUndefined();
  });
});
