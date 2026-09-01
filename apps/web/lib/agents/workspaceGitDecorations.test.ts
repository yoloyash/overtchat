import { describe, expect, it } from "vitest";
import type { AgentWorkspaceGitFile } from "@overtchat/agent-bridge";
import {
  agentWorkspaceGitDecorationMap,
  agentWorkspaceGitFileDecoration,
} from "./workspaceGitDecorations";

function file(
  path: string,
  indexStatus: string | null,
  worktreeStatus: string | null,
): AgentWorkspaceGitFile {
  return { path, originalPath: null, indexStatus, worktreeStatus };
}

describe("agent workspace Git decorations", () => {
  it("maps porcelain status combinations to familiar editor decorations", () => {
    expect(
      agentWorkspaceGitFileDecoration(file("new.ts", null, "?")),
    ).toMatchObject({
      kind: "added",
      code: "U",
    });
    expect(
      agentWorkspaceGitFileDecoration(file("staged.ts", "A", null)),
    ).toMatchObject({
      kind: "added",
      code: "A",
    });
    expect(
      agentWorkspaceGitFileDecoration(file("changed.ts", null, "M")),
    ).toMatchObject({
      kind: "modified",
      code: "M",
    });
    expect(
      agentWorkspaceGitFileDecoration(file("gone.ts", "D", null)),
    ).toMatchObject({
      kind: "deleted",
      code: "D",
    });
    expect(
      agentWorkspaceGitFileDecoration(file("moved.ts", "R", null)),
    ).toMatchObject({
      kind: "renamed",
      code: "R",
    });
    expect(
      agentWorkspaceGitFileDecoration(file("conflict.ts", "U", "U")),
    ).toMatchObject({
      kind: "conflicted",
      code: "!",
    });
  });

  it("decorates parent directories with their strongest descendant status", () => {
    const decorations = agentWorkspaceGitDecorationMap([
      file("src/new.ts", null, "?"),
      file("src/components/changed.tsx", null, "M"),
      file("src/components/conflict.tsx", "U", "U"),
    ]);

    expect(decorations.get("src/new.ts")?.kind).toBe("added");
    expect(decorations.get("src/components/changed.tsx")?.kind).toBe(
      "modified",
    );
    expect(decorations.get("src/components")?.kind).toBe("conflicted");
    expect(decorations.get("src")?.kind).toBe("conflicted");
  });
});
