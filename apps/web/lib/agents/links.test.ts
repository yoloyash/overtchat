import { describe, expect, it } from "vitest";
import {
  agentLinkIconKind,
  classifyAgentLink,
  compactExternalLinkLabel,
  remarkAgentLinks,
} from "./links";

describe("classifyAgentLink", () => {
  it("separates external URLs from GitHub lookalikes", () => {
    const github = classifyAgentLink({
      href: "https://github.com/overtchat/overtchat/pull/232",
    });
    const lookalike = classifyAgentLink({
      href: "https://github.com.example.com/unsafe/file.ts",
    });

    expect(github).toEqual({
      kind: "external",
      url: "https://github.com/overtchat/overtchat/pull/232",
    });
    expect(agentLinkIconKind(github)).toBe("github");
    expect(agentLinkIconKind(lookalike)).toBe("web");
  });

  it("parses workspace files and line ranges without binding a workspace id", () => {
    expect(
      classifyAgentLink({ href: "apps/web/components/App.tsx#L12-L20" }),
    ).toEqual({
      kind: "workspace-file",
      raw: "apps/web/components/App.tsx#L12-L20",
      path: "apps/web/components/App.tsx",
      lineStart: 12,
      lineEnd: 20,
    });
    expect(classifyAgentLink({ href: "src/server.ts:42:7" })).toEqual({
      kind: "workspace-file",
      raw: "src/server.ts:42:7",
      path: "src/server.ts",
      lineStart: 42,
    });
    expect(classifyAgentLink({ href: "file:///tmp/project/main.py#L8" })).toEqual({
      kind: "workspace-file",
      raw: "file:///tmp/project/main.py#L8",
      path: "/tmp/project/main.py",
      lineStart: 8,
    });
  });

  it("uses conservative file heuristics with a generic explicit-path fallback", () => {
    expect(classifyAgentLink({ href: "docs.example.com/file.ts" })).toEqual({
      kind: "unknown",
      href: "docs.example.com/file.ts",
    });
    const generic = classifyAgentLink({ href: "./fixtures/custom.xyz" });
    expect(generic).toMatchObject({
      kind: "workspace-file",
      path: "./fixtures/custom.xyz",
    });
    expect(agentLinkIconKind(generic)).toBe("file");
  });
});

describe("agentLinkIconKind", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/app.jsx", "javascript"],
    ["config/settings.json", "json"],
    ["docs/README.md", "markdown"],
    ["scripts/release.py", "python"],
    ["src/main.c", "c"],
    ["src/main.cpp", "cplusplus"],
    ["src/App.cs", "csharp"],
    ["cmd/server.go", "go"],
    ["src/main.rs", "rust"],
    ["src/Main.java", "code"],
    ["./fixtures/custom.xyz", "file"],
  ] as const)("maps %s to the %s icon", (href, icon) => {
    expect(agentLinkIconKind(classifyAgentLink({ href }))).toBe(icon);
  });
});

describe("compactExternalLinkLabel", () => {
  it("formats raw GitHub pull requests and ordinary web URLs", () => {
    expect(
      compactExternalLinkLabel("https://github.com/overtchat/overtchat/pull/232"),
    ).toBe("overtchat/overtchat PR #232");
    expect(compactExternalLinkLabel("https://docs.example.com/guide/start"))
      .toBe("docs.example.com/guide/start");
    expect(compactExternalLinkLabel("javascript:alert(1)"))
      .toBeNull();
  });
});

describe("remarkAgentLinks", () => {
  it("decorates external and workspace links without replacing authored labels", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "link",
          url: "https://github.com/overtchat/overtchat/pull/232",
          children: [
            {
              type: "text",
              value: "https://github.com/overtchat/overtchat/pull/232",
            },
          ],
        },
        {
          type: "link",
          url: "apps/web/src/app.ts#L12",
          children: [{ type: "text", value: "the app entrypoint" }],
        },
      ],
    };

    remarkAgentLinks()(tree);

    expect(tree.children[0].children).toEqual([
      {
        type: "agent-link-icon",
        data: {
          hName: "agent-link-icon",
          hProperties: { kind: "github" },
        },
      },
      { type: "text", value: "overtchat/overtchat PR #232" },
    ]);
    expect(tree.children[1].children).toEqual([
      {
        type: "agent-link-icon",
        data: {
          hName: "agent-link-icon",
          hProperties: { kind: "typescript" },
        },
      },
      { type: "text", value: "the app entrypoint" },
    ]);
    expect(
      (tree.children[1] as (typeof tree.children)[number] & { data?: unknown })
        .data,
    ).toEqual({
      hName: "agent-workspace-link",
      hProperties: {
        path: "apps/web/src/app.ts",
        linestart: 12,
      },
    });
  });
});
