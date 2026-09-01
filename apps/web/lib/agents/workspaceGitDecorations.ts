import type { AgentWorkspaceGitFile } from "@overtchat/agent-bridge";

export type AgentWorkspaceGitDecorationKind =
  "added" | "conflicted" | "deleted" | "ignored" | "modified" | "renamed";

export type AgentWorkspaceGitDecoration = {
  kind: AgentWorkspaceGitDecorationKind;
  code: string;
  label: string;
};

export const ignoredGitDecoration: AgentWorkspaceGitDecoration = {
  kind: "ignored",
  code: "",
  label: "Ignored",
};

const decorationPriority: Record<AgentWorkspaceGitDecorationKind, number> = {
  ignored: 0,
  added: 1,
  modified: 2,
  renamed: 2,
  deleted: 3,
  conflicted: 4,
};

function hasStatus(file: AgentWorkspaceGitFile, status: string): boolean {
  return file.indexStatus === status || file.worktreeStatus === status;
}

export function agentWorkspaceGitFileDecoration(
  file: AgentWorkspaceGitFile,
): AgentWorkspaceGitDecoration {
  const conflicted =
    hasStatus(file, "U") ||
    (file.indexStatus === "A" && file.worktreeStatus === "A") ||
    (file.indexStatus === "D" && file.worktreeStatus === "D");
  if (conflicted) {
    return { kind: "conflicted", code: "!", label: "Conflicted" };
  }
  if (hasStatus(file, "D")) {
    return { kind: "deleted", code: "D", label: "Deleted" };
  }
  if (hasStatus(file, "R") || hasStatus(file, "C")) {
    return { kind: "renamed", code: "R", label: "Renamed" };
  }
  if (file.worktreeStatus === "?") {
    return { kind: "added", code: "U", label: "Untracked" };
  }
  if (hasStatus(file, "A")) {
    return { kind: "added", code: "A", label: "Added" };
  }
  return { kind: "modified", code: "M", label: "Modified" };
}

function normalizedPath(value: string): string {
  return value.replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function parentPath(value: string): string | null {
  const separator = value.lastIndexOf("/");
  return separator > 0 ? value.slice(0, separator) : null;
}

function setStrongestDecoration(
  decorations: Map<string, AgentWorkspaceGitDecoration>,
  path: string,
  decoration: AgentWorkspaceGitDecoration,
): void {
  const current = decorations.get(path);
  if (
    !current ||
    decorationPriority[decoration.kind] > decorationPriority[current.kind]
  ) {
    decorations.set(path, decoration);
  }
}

export function agentWorkspaceGitDecorationMap(
  files: AgentWorkspaceGitFile[],
): Map<string, AgentWorkspaceGitDecoration> {
  const decorations = new Map<string, AgentWorkspaceGitDecoration>();
  for (const file of files) {
    const path = normalizedPath(file.path);
    if (!path) continue;
    const decoration = agentWorkspaceGitFileDecoration(file);
    setStrongestDecoration(decorations, path, decoration);
    let parent = parentPath(path);
    while (parent) {
      setStrongestDecoration(decorations, parent, decoration);
      parent = parentPath(parent);
    }
  }
  return decorations;
}
