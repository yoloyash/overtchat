import {
  AGENT_WORKSPACE_FILE_DIFF_MAX_BYTES,
  AGENT_WORKSPACE_IMAGE_MAX_BYTES,
  AGENT_WORKSPACE_IMAGE_MEDIA_TYPES,
  type AgentWorkspaceDirectoryListing,
  type AgentWorkspaceFileDiff,
  type AgentWorkspaceFilePreview,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const INVALID_DIRECTORY_MESSAGE =
  "The remote machine returned an invalid workspace directory.";
const INVALID_FILE_MESSAGE =
  "The remote machine returned an invalid workspace file.";
const INVALID_DIFF_MESSAGE =
  "The remote machine returned an invalid workspace file diff.";
// Base64 text of the largest image, plus the JSON around it.
const IMAGE_CAPTURE_BYTES =
  Math.ceil(AGENT_WORKSPACE_IMAGE_MAX_BYTES / 3) * 4 + 64 * 1024;

export const AGENT_WORKSPACE_FILES_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_DIRECTORY_ENTRIES = 1000;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = ${AGENT_WORKSPACE_IMAGE_MAX_BYTES};
const IMAGE_MEDIA_TYPES = ${JSON.stringify(AGENT_WORKSPACE_IMAGE_MEDIA_TYPES)};
const MAX_DIFF_BYTES = ${AGENT_WORKSPACE_FILE_DIFF_MAX_BYTES};
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const READ_FLAGS = process.platform === "win32"
  ? fs.constants.O_RDONLY
  : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
const action = process.argv[1];
const workspaceRoot = process.argv[2];
const requestedPath = process.argv[3] || ".";
// "images" for a read that may return an image; a renamed file's old path for a diff.
const option = process.argv[4] || "";

function fail(message) {
  throw new Error(message);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && !relative.startsWith(".." + path.sep) && relative !== "..");
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

function ignoredPaths(root, entries) {
  if (entries.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
    cwd: root,
    input: entries.map((entry) => entry.path).join("\\0") + "\\0",
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return new Set();
  }
  return new Set(String(result.stdout || "").split("\\0").filter(Boolean));
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
  const visibleEntries = entries.slice(0, MAX_DIRECTORY_ENTRIES);
  const ignored = ignoredPaths(root, visibleEntries);
  return {
    path: relativePath(root, target.lexical),
    entries: visibleEntries.map((entry) =>
      ignored.has(entry.path) ? { ...entry, ignored: true } : entry
    ),
    truncated: entries.length > MAX_DIRECTORY_ENTRIES,
  };
}

function read(root, target) {
  let descriptor;
  try {
    descriptor = fs.openSync(target.resolved, READ_FLAGS);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) fail("Path is not a regular file.");
    const extension = path.extname(target.lexical).slice(1).toLowerCase();
    const imageType =
      option === "images" &&
      Object.prototype.hasOwnProperty.call(IMAGE_MEDIA_TYPES, extension)
        ? IMAGE_MEDIA_TYPES[extension]
        : null;
    if (imageType && before.size > MAX_IMAGE_BYTES) {
      fail("Image is too large to preview (maximum 5 MB).");
    }
    if (!imageType && before.size > MAX_PREVIEW_BYTES) {
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
    if (imageType) {
      return {
        kind: "image",
        encoding: "base64",
        mediaType: imageType,
        path: relativePath(root, target.lexical),
        content: bytes.toString("base64"),
        size: after.size,
        modifiedAt: after.mtimeMs,
      };
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

function workspaceRelative(root, value) {
  const lexical = path.resolve(root, value);
  if (lexical === root || !inside(root, lexical)) fail("Path is outside the workspace.");
  return relativePath(root, lexical);
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_DIFF_BYTES,
    // Reading a diff must not take the index lock from the agent's own Git
    // commands, and a file name is never a pattern.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" },
    windowsHide: true,
  });
  if (result.error && result.error.code === "ENOENT") {
    fail("Git is not installed on the selected machine.");
  }
  return result;
}

function patchText(result, successStatuses) {
  const truncated = Boolean(result.error && result.error.code === "ENOBUFS");
  if (result.error && !truncated) fail(result.error.message);
  if (!truncated && !successStatuses.includes(result.status)) {
    fail(String(result.stderr || "").trim() || "Git exited with code " + String(result.status));
  }
  const output = String(result.stdout || "");
  if (!truncated) return { text: output, truncated };
  // A killed process can hand back slightly more than the limit.
  const text = Buffer.from(output, "utf8").subarray(0, MAX_DIFF_BYTES).toString("utf8");
  return { text: text.slice(0, text.lastIndexOf("\\n") + 1), truncated };
}

// The file's uncommitted changes against the last commit, as git diff HEAD
// reports them. A file Git does not track yet is all additions.
function diff(root) {
  const filePath = workspaceRelative(root, requestedPath);
  const originalPath = option ? workspaceRelative(root, option) : null;
  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  if (head.status !== 0 && /not a git repository/i.test(String(head.stderr || ""))) {
    fail("This workspace is not a Git repository.");
  }
  const display = ["--no-color", "--no-ext-diff", "--no-textconv"];
  let patch = { text: "", truncated: false };
  if (head.status === 0) {
    patch = patchText(
      git(
        ["diff", ...display, "--relative", "-M", "HEAD", "--"]
          .concat(originalPath ? [originalPath] : [], [filePath]),
        root,
      ),
      [0],
    );
  }
  if (!patch.text && !patch.truncated) {
    const tracked =
      head.status === 0 &&
      git(["ls-files", "--error-unmatch", "--", filePath], root).status === 0;
    let stat = null;
    try {
      stat = fs.lstatSync(path.resolve(root, filePath));
    } catch {}
    // Only a regular file inside the workspace is read from disk.
    if (!tracked && stat && stat.isFile()) {
      resolveTarget(root);
      patch = patchText(
        git(["diff", ...display, "--no-index", "--", "/dev/null", filePath], root),
        [0, 1],
      );
    }
  }
  const binary = /^Binary files .* differ$/m.test(patch.text);
  return {
    path: filePath,
    patch: binary ? "" : patch.text,
    truncated: patch.truncated,
    binary,
  };
}

try {
  const root = canonicalRoot();
  const result = action === "list"
    ? list(root, resolveTarget(root))
    : action === "read"
      ? read(root, resolveTarget(root))
      : action === "diff"
        ? diff(root)
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
        typeof Reflect.get(entry, "symlink") === "boolean" &&
        (Reflect.get(entry, "ignored") === undefined ||
          typeof Reflect.get(entry, "ignored") === "boolean"),
    )
  );
}

function isWorkspaceFilePreview(
  value: unknown,
  images: boolean,
): value is AgentWorkspaceFilePreview {
  if (!value || typeof value !== "object") return false;
  const kind = Reflect.get(value, "kind");
  const text = kind === "text" && Reflect.get(value, "encoding") === "utf-8";
  const image =
    images &&
    kind === "image" &&
    Reflect.get(value, "encoding") === "base64" &&
    Object.values<unknown>(AGENT_WORKSPACE_IMAGE_MEDIA_TYPES).includes(
      Reflect.get(value, "mediaType"),
    );
  return Boolean(
    (text || image) &&
      typeof Reflect.get(value, "path") === "string" &&
      typeof Reflect.get(value, "content") === "string" &&
      typeof Reflect.get(value, "size") === "number" &&
      typeof Reflect.get(value, "modifiedAt") === "number",
  );
}

function isWorkspaceFileDiff(value: unknown): value is AgentWorkspaceFileDiff {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof Reflect.get(value, "path") === "string" &&
      typeof Reflect.get(value, "patch") === "string" &&
      typeof Reflect.get(value, "truncated") === "boolean" &&
      typeof Reflect.get(value, "binary") === "boolean",
  );
}

async function executeWorkspaceFilesRequest(
  target: HostTarget,
  action: "list" | "read" | "diff",
  workspaceRoot: string,
  requestedPath: string,
  option?: string,
): Promise<unknown> {
  const launch = {
    command: "node",
    args: [
      "-e",
      AGENT_WORKSPACE_FILES_SCRIPT,
      action,
      workspaceRoot,
      requestedPath,
      ...(option ? [option] : []),
    ],
  };
  const result =
    option === "images"
      ? await executeOnHost(target, launch, {
          maxCaptureBytes: IMAGE_CAPTURE_BYTES,
        })
      : await executeOnHost(target, launch);
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
    /** `images` also reads image files; without it they fail as binary. */
    options?: { images?: boolean },
  ): Promise<AgentWorkspaceFilePreview>;
  readFileDiff(
    target: HostTarget,
    workspaceRoot: string,
    filePath: string,
    originalPath?: string,
  ): Promise<AgentWorkspaceFileDiff>;
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
    options: { images?: boolean } = {},
  ): Promise<AgentWorkspaceFilePreview> {
    const images = options.images === true;
    const parsed = await executeWorkspaceFilesRequest(
      target,
      "read",
      workspaceRoot,
      filePath,
      images ? "images" : undefined,
    );
    if (!isWorkspaceFilePreview(parsed, images)) {
      throw new Error(INVALID_FILE_MESSAGE);
    }
    return parsed;
  }

  async readFileDiff(
    target: HostTarget,
    workspaceRoot: string,
    filePath: string,
    originalPath?: string,
  ): Promise<AgentWorkspaceFileDiff> {
    const parsed = await executeWorkspaceFilesRequest(
      target,
      "diff",
      workspaceRoot,
      filePath,
      originalPath,
    );
    if (!isWorkspaceFileDiff(parsed)) {
      throw new Error(INVALID_DIFF_MESSAGE);
    }
    return parsed;
  }
}

export const workspaceFilesService: WorkspaceFilesService =
  new HostWorkspaceFilesService();
