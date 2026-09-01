import type {
  AgentWorkspaceDirectoryListing,
  AgentWorkspaceFilePreview,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const INVALID_DIRECTORY_MESSAGE =
  "The remote machine returned an invalid workspace directory.";
const INVALID_FILE_MESSAGE =
  "The remote machine returned an invalid workspace file.";

export const AGENT_WORKSPACE_FILES_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");

const MAX_DIRECTORY_ENTRIES = 1000;
const MAX_PREVIEW_BYTES = 512 * 1024;
const READ_FLAGS = process.platform === "win32"
  ? fs.constants.O_RDONLY
  : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
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
  const entries = [];
  for (const name of names) {
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
  return {
    path: relativePath(root, target.lexical),
    entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated: entries.length > MAX_DIRECTORY_ENTRIES,
  };
}

function read(root, target) {
  let descriptor;
  try {
    descriptor = fs.openSync(target.resolved, READ_FLAGS);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) fail("Path is not a regular file.");
    if (before.size > MAX_PREVIEW_BYTES) {
      fail("File is too large to preview (maximum 512 KB).");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      fail("File changed while it was being read.");
    }
    if (bytes.includes(0)) fail("Binary files cannot be previewed.");
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("File is not valid UTF-8 text.");
    }
    return {
      kind: "text",
      encoding: "utf-8",
      path: relativePath(root, target.lexical),
      content,
      size: after.size,
      modifiedAt: after.mtimeMs,
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
      Reflect.get(value, "kind") === "text" &&
      Reflect.get(value, "encoding") === "utf-8" &&
      typeof Reflect.get(value, "path") === "string" &&
      typeof Reflect.get(value, "content") === "string" &&
      typeof Reflect.get(value, "size") === "number" &&
      typeof Reflect.get(value, "modifiedAt") === "number",
  );
}

async function executeWorkspaceFilesRequest(
  target: HostTarget,
  action: "list" | "read",
  workspaceRoot: string,
  requestedPath: string,
): Promise<unknown> {
  const result = await executeOnHost(target, {
    command: "node",
    args: [
      "-e",
      AGENT_WORKSPACE_FILES_SCRIPT,
      action,
      workspaceRoot,
      requestedPath,
    ],
  });
  return JSON.parse(result.stdout) as unknown;
}

export interface WorkspaceFilesService {
  listDirectory(
    target: HostTarget,
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<AgentWorkspaceDirectoryListing>;
  readFile(
    target: HostTarget,
    workspaceRoot: string,
    filePath: string,
  ): Promise<AgentWorkspaceFilePreview>;
}

class HostWorkspaceFilesService implements WorkspaceFilesService {
  async listDirectory(
    target: HostTarget,
    workspaceRoot: string,
    directoryPath: string,
  ): Promise<AgentWorkspaceDirectoryListing> {
    const parsed = await executeWorkspaceFilesRequest(
      target,
      "list",
      workspaceRoot,
      directoryPath,
    );
    if (!isWorkspaceDirectoryListing(parsed)) {
      throw new Error(INVALID_DIRECTORY_MESSAGE);
    }
    return parsed;
  }

  async readFile(
    target: HostTarget,
    workspaceRoot: string,
    filePath: string,
  ): Promise<AgentWorkspaceFilePreview> {
    const parsed = await executeWorkspaceFilesRequest(
      target,
      "read",
      workspaceRoot,
      filePath,
    );
    if (!isWorkspaceFilePreview(parsed)) {
      throw new Error(INVALID_FILE_MESSAGE);
    }
    return parsed;
  }
}

export const workspaceFilesService: WorkspaceFilesService =
  new HostWorkspaceFilesService();
