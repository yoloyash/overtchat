import type { AgentTurnChanges } from "@overtchat/agent-bridge";

export type AgentTurnChangesFileNode = {
  kind: "file";
  name: string;
  /** Unique within one turn's changes; relative to the workspace when inside it. */
  path: string;
  /** The path to open in the workspace; null for a file outside it. */
  workspacePath: string | null;
  /** Shown relative to the workspace, like `path`. */
  previousPath: string | null;
  additions: number;
  deletions: number;
};

export type AgentTurnChangesDirectoryNode = {
  kind: "directory";
  /** Several segments when the folders between hold nothing else. */
  name: string;
  path: string;
  additions: number;
  deletions: number;
  children: AgentTurnChangesNode[];
};

export type AgentTurnChangesNode =
  | AgentTurnChangesFileNode
  | AgentTurnChangesDirectoryNode;

export type AgentTurnChangesRow = {
  node: AgentTurnChangesNode;
  depth: number;
};

type Folder = {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: AgentTurnChangesFileNode[];
};

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function nodesOf(folder: Folder): AgentTurnChangesNode[] {
  const directories = [...folder.folders.values()].sort(byName).map((child) => {
    let name = child.name;
    let current = child;
    // A chain of folders with nothing else in them reads as one row.
    while (current.files.length === 0 && current.folders.size === 1) {
      current = [...current.folders.values()][0];
      name = `${name}/${current.name}`;
    }
    const children = nodesOf(current);
    const directory: AgentTurnChangesDirectoryNode = {
      kind: "directory",
      name,
      path: current.path,
      additions: 0,
      deletions: 0,
      children,
    };
    for (const node of children) {
      directory.additions += node.additions;
      directory.deletions += node.deletions;
    }
    return directory;
  });
  return [...directories, ...[...folder.files].sort(byName)];
}

/** Folders first, then files, shown from the workspace's folder. */
export function buildAgentTurnChangesTree(
  changes: Pick<AgentTurnChanges, "files" | "workspacePath">,
): AgentTurnChangesNode[] {
  const prefix = changes.workspacePath ? `${changes.workspacePath}/` : "";
  const inside = (path: string) => !prefix || path.startsWith(prefix);
  const shown = (path: string) =>
    prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const root: Folder = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of changes.files) {
    const path = shown(file.path);
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    let folder = root;
    for (const segment of segments) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: folder.path ? `${folder.path}/${segment}` : segment,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.files.push({
      kind: "file",
      name,
      path,
      workspacePath: inside(file.path) ? path : null,
      previousPath: file.previousPath ? shown(file.previousPath) : null,
      additions: file.additions,
      deletions: file.deletions,
    });
  }
  return nodesOf(root);
}

/** The rows on screen: a closed folder hides everything under it. */
export function agentTurnChangesRows(
  nodes: readonly AgentTurnChangesNode[],
  open: (directoryPath: string) => boolean,
  depth = 0,
): AgentTurnChangesRow[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.kind === "directory" && open(node.path)
      ? agentTurnChangesRows(node.children, open, depth + 1)
      : []),
  ]);
}

export function agentTurnChangesDirectories(
  nodes: readonly AgentTurnChangesNode[],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory"
      ? [node.path, ...agentTurnChangesDirectories(node.children)]
      : [],
  );
}

export function agentTurnChangesLabel(files: number): string {
  return `${files.toLocaleString("en-US")} changed ${files === 1 ? "file" : "files"}`;
}

/** 950, 1.2k, 15k, 2.4m: line counts stay narrow enough to line up. */
export function formatAgentChangeCount(value: number): string {
  if (value < 1000) return String(value);
  for (const [unit, size] of [["k", 1e3], ["m", 1e6], ["b", 1e9]] as const) {
    const scaled = value / size;
    if (unit !== "b" && scaled >= 999.5) continue;
    return `${scaled < 9.95 ? scaled.toFixed(1).replace(/\.0$/, "") : Math.round(scaled)}${unit}`;
  }
  return String(value);
}
