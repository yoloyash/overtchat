import path from "node:path";
import type {
  AgentWorkspaceDirectoryListing,
  AgentWorkspaceFilePreview,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const DIRECTORY_PROBE = `
const fs = require("node:fs");
const path = require("node:path");
const input = process.argv[1];
const resolved = fs.realpathSync(input);
const stat = fs.statSync(resolved);
if (!stat.isDirectory()) throw new Error("Path is not a directory.");
fs.readdirSync(resolved);
process.stdout.write(JSON.stringify({ path: resolved, name: path.basename(resolved) || resolved }));
`.trim();

const DIRECTORY_LIST = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const requested = process.argv[1] || os.homedir();
const resolved = fs.realpathSync(requested);
if (!fs.statSync(resolved).isDirectory()) throw new Error("Path is not a directory.");
const directories = fs.readdirSync(resolved, { withFileTypes: true })
  .flatMap((entry) => {
    const full = path.join(resolved, entry.name);
    try {
      return entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())
        ? [{ name: entry.name, path: full }]
        : [];
    } catch {
      return [];
    }
  })
  .sort((left, right) => left.name.localeCompare(right.name));
const root = path.parse(resolved).root;
process.stdout.write(JSON.stringify({
  path: resolved,
  parent: resolved === root ? null : path.dirname(resolved),
  directories,
}));
`.trim();

export const AGENT_WORKSPACE_FILES_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");

const MAX_DIRECTORY_ENTRIES = 1000;
const MAX_PREVIEW_BYTES = 512 * 1024;
const action = process.argv[1];
const workspaceRoot = process.argv[2];
const requestedPath = process.argv[3] || ".";

function fail(message) {
  throw new Error(message);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== "..");
}

function canonicalRoot() {
  const root = fs.realpathSync(workspaceRoot);
  if (!fs.statSync(root).isDirectory()) fail("Workspace root is not a directory.");
  return root;
}

function resolveTarget(root) {
  const lexical = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  if (!inside(root, lexical)) fail("Path is outside the workspace.");
  const resolved = fs.realpathSync(lexical);
  if (!inside(root, resolved)) fail("Path resolves outside the workspace.");
  return { lexical, resolved };
}

function relativePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function list(root, target) {
  if (!fs.statSync(target.resolved).isDirectory()) fail("Path is not a directory.");
  const names = fs.readdirSync(target.resolved).filter((name) => name !== ".git");
  const truncated = names.length > MAX_DIRECTORY_ENTRIES;
  const entries = [];
  for (const name of names.slice(0, MAX_DIRECTORY_ENTRIES)) {
    const lexical = path.join(target.lexical, name);
    const relative = relativePath(root, lexical);
    try {
      const linkStat = fs.lstatSync(lexical);
      const symlink = linkStat.isSymbolicLink();
      if (!symlink) {
        entries.push({
          name,
          path: relative,
          kind: linkStat.isDirectory() ? "directory" : linkStat.isFile() ? "file" : "symlink",
          symlink: false,
        });
        continue;
      }
      const resolved = fs.realpathSync(lexical);
      if (!inside(root, resolved)) {
        entries.push({ name, path: relative, kind: "symlink", symlink: true });
        continue;
      }
      const stat = fs.statSync(resolved);
      entries.push({
        name,
        path: relative,
        kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "symlink",
        symlink: true,
      });
    } catch {
      entries.push({ name, path: relative, kind: "symlink", symlink: true });
    }
  }
  entries.sort((left, right) => {
    const leftDirectory = left.kind === "directory" ? 0 : 1;
    const rightDirectory = right.kind === "directory" ? 0 : 1;
    return leftDirectory - rightDirectory || left.name.localeCompare(right.name);
  });
  return { path: relativePath(root, target.lexical), entries, truncated };
}

function read(root, target) {
  const stat = fs.statSync(target.resolved);
  if (!stat.isFile()) fail("Path is not a regular file.");
  if (stat.size > MAX_PREVIEW_BYTES) {
    fail("File is too large to preview (maximum 512 KB).");
  }
  const bytes = fs.readFileSync(target.resolved);
  if (bytes.includes(0)) fail("Binary files cannot be previewed.");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("File is not valid UTF-8 text.");
  }
  return {
    path: relativePath(root, target.lexical),
    content,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

try {
  const root = canonicalRoot();
  const target = resolveTarget(root);
  const result = action === "list"
    ? list(root, target)
    : action === "read"
      ? read(root, target)
      : fail("Unknown workspace file operation.");
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`.trim();

export type ProbedWorkspace = {
  path: string;
  name: string;
};

export type ProbedDirectoryListing = {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
};

function isWorkspaceDirectoryListing(
  value: unknown,
): value is AgentWorkspaceDirectoryListing {
  if (!value || typeof value !== "object") return false;
  const entries = Reflect.get(value, "entries");
  return (
    typeof Reflect.get(value, "path") === "string" &&
    typeof Reflect.get(value, "truncated") === "boolean" &&
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof Reflect.get(entry, "name") === "string" &&
        typeof Reflect.get(entry, "path") === "string" &&
        ["file", "directory", "symlink"].includes(
          String(Reflect.get(entry, "kind")),
        ) &&
        typeof Reflect.get(entry, "symlink") === "boolean",
    )
  );
}

function isWorkspaceFilePreview(
  value: unknown,
): value is AgentWorkspaceFilePreview {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof Reflect.get(value, "path") === "string" &&
      typeof Reflect.get(value, "content") === "string" &&
      typeof Reflect.get(value, "size") === "number" &&
      typeof Reflect.get(value, "modifiedAt") === "number",
  );
}

export async function probeAgentWorkspace(
  target: HostTarget,
  workspacePath: string,
): Promise<ProbedWorkspace> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", DIRECTORY_PROBE, workspacePath],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof Reflect.get(parsed, "path") !== "string" ||
    typeof Reflect.get(parsed, "name") !== "string"
  ) {
    throw new Error("The remote machine returned invalid directory metadata.");
  }
  return {
    path: Reflect.get(parsed, "path") as string,
    name:
      (Reflect.get(parsed, "name") as string) ||
      path.posix.basename(Reflect.get(parsed, "path") as string),
  };
}

export async function listAgentDirectories(
  target: HostTarget,
  directoryPath?: string,
): Promise<ProbedDirectoryListing> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", DIRECTORY_LIST, directoryPath ?? ""],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The remote machine returned an invalid directory list.");
  }
  const pathValue = Reflect.get(parsed, "path");
  const parent = Reflect.get(parsed, "parent");
  const directories = Reflect.get(parsed, "directories");
  if (
    typeof pathValue !== "string" ||
    (parent !== null && typeof parent !== "string") ||
    !Array.isArray(directories) ||
    !directories.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof Reflect.get(entry, "name") === "string" &&
        typeof Reflect.get(entry, "path") === "string",
    )
  ) {
    throw new Error("The remote machine returned an invalid directory list.");
  }
  return {
    path: pathValue,
    parent,
    directories: directories.map((entry) => ({
      name: Reflect.get(entry, "name") as string,
      path: Reflect.get(entry, "path") as string,
    })),
  };
}

export async function listAgentWorkspaceDirectory(
  target: HostTarget,
  workspaceRoot: string,
  directoryPath: string,
): Promise<AgentWorkspaceDirectoryListing> {
  const result = await executeOnHost(target, {
    command: "node",
    args: [
      "-e",
      AGENT_WORKSPACE_FILES_SCRIPT,
      "list",
      workspaceRoot,
      directoryPath,
    ],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!isWorkspaceDirectoryListing(parsed)) {
    throw new Error("The remote machine returned an invalid workspace directory.");
  }
  return parsed;
}

export async function readAgentWorkspaceFile(
  target: HostTarget,
  workspaceRoot: string,
  filePath: string,
): Promise<AgentWorkspaceFilePreview> {
  const result = await executeOnHost(target, {
    command: "node",
    args: [
      "-e",
      AGENT_WORKSPACE_FILES_SCRIPT,
      "read",
      workspaceRoot,
      filePath,
    ],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!isWorkspaceFilePreview(parsed)) {
    throw new Error("The remote machine returned an invalid workspace file.");
  }
  return parsed;
}
