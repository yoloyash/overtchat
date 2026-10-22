import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import {
  executeOnHost,
  spawnOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

// Shared by the one-shot probe and the long-lived watcher. Both run under the
// host's own Node so local, SSH, and Windows targets execute identical code.
const AGENT_WORKSPACE_GIT_INSPECTION = `
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 4 * 1024 * 1024;

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    // Status must not refresh the index: that write would race the agent's
    // own Git commands for index.lock and wake the watcher in a loop.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("Git is not installed on the selected machine.");
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      String(result.stderr || "").trim() ||
        "Git exited with code " + String(result.status),
    );
  }
  return String(result.stdout || "");
}

function parseStatus(value) {
  const records = value.split("\\0");
  let branch = null;
  let upstream = null;
  let ahead = null;
  let behind = null;
  let initial = false;
  let changedFiles = 0;
  const untrackedPaths = [];
  const files = [];

  function statusValue(value) {
    return value && value !== "." && value !== " " ? value : null;
  }

  function trackedFile(record, fieldCount, originalPath = null) {
    const fields = record.split(" ");
    const xy = fields[1] || "..";
    return {
      path: fields.slice(fieldCount).join(" "),
      originalPath,
      indexStatus: statusValue(xy[0]),
      worktreeStatus: statusValue(xy[1]),
    };
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      initial = record.slice(13) === "(initial)";
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const head = record.slice(14);
      branch = head === "(detached)" ? null : head;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice(18) || null;
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\\.ab \\+(\\d+) -(\\d+)$/.exec(record);
      if (match) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
      continue;
    }
    if (record.startsWith("2 ")) {
      changedFiles += 1;
      const originalPath = records[index + 1] || null;
      files.push(trackedFile(record, 9, originalPath));
      index += 1;
      continue;
    }
    if (record.startsWith("1 ")) {
      changedFiles += 1;
      files.push(trackedFile(record, 8));
      continue;
    }
    if (record.startsWith("u ")) {
      changedFiles += 1;
      files.push(trackedFile(record, 10));
      continue;
    }
    if (record.startsWith("? ")) {
      changedFiles += 1;
      const filePath = record.slice(2);
      untrackedPaths.push(filePath);
      files.push({
        path: filePath,
        originalPath: null,
        indexStatus: null,
        worktreeStatus: "?",
      });
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    initial,
    changedFiles,
    untrackedPaths,
    files,
  };
}

function parseNumstat(value) {
  let additions = 0;
  let deletions = 0;
  let complete = true;

  for (const record of value.split("\\0")) {
    const firstTab = record.indexOf("\\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    if (added === "-" || deleted === "-") {
      complete = false;
      continue;
    }
    additions += Number.parseInt(added, 10) || 0;
    deletions += Number.parseInt(deleted, 10) || 0;
  }

  return { additions, deletions, complete };
}

function countAddedLines(repositoryRoot, relativePaths) {
  let additions = 0;
  let bytesRead = 0;
  let complete = true;
  const rootPrefix = repositoryRoot.endsWith(path.sep)
    ? repositoryRoot
    : repositoryRoot + path.sep;

  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    if (
      absolutePath !== repositoryRoot &&
      !absolutePath.startsWith(rootPrefix)
    ) {
      complete = false;
      continue;
    }
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile()) {
        complete = false;
        continue;
      }
      if (
        stat.size > MAX_SINGLE_FILE_BYTES ||
        bytesRead + stat.size > MAX_TOTAL_FILE_BYTES
      ) {
        complete = false;
        continue;
      }
      const content = fs.readFileSync(absolutePath);
      bytesRead += content.length;
      if (content.includes(0)) {
        complete = false;
        continue;
      }
      let lines = 0;
      for (const byte of content) {
        if (byte === 10) lines += 1;
      }
      if (content.length > 0 && content[content.length - 1] !== 10) {
        lines += 1;
      }
      additions += lines;
    } catch {
      complete = false;
    }
  }

  return { additions, complete };
}

function inspectWorkspace(cwd) {
  let repositoryRoot;
  try {
    repositoryRoot = runGit(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository|must be run in a work tree/i.test(message)) {
      return { isGit: false };
    }
    throw error;
  }

  const workspacePrefix = path
    .relative(repositoryRoot, cwd)
    .split(path.sep)
    .join("/");
  const workspacePathspec = workspacePrefix || ".";
  const scopedPath = (filePath) => {
    if (!workspacePrefix) return filePath;
    const prefix = workspacePrefix + "/";
    return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
  };

  const rawStatus = runGit(
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
      "--",
      workspacePathspec,
    ],
    repositoryRoot,
  );
  const status = parseStatus(rawStatus);
  status.files = status.files.flatMap((file) => {
    const filePath = scopedPath(file.path);
    if (filePath === null) return [];
    const originalPath = file.originalPath === null
      ? null
      : scopedPath(file.originalPath);
    return [{ ...file, path: filePath, originalPath }];
  });
  status.changedFiles = status.files.length;
  const rawNumstat = status.initial
    ? ""
    : runGit(
        ["diff", "--numstat", "-z", "HEAD", "--", workspacePathspec],
        repositoryRoot,
      );
  const numstat = parseNumstat(rawNumstat);
  const supplementalPaths = status.initial
    ? runGit(
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", workspacePathspec],
        repositoryRoot,
      )
        .split("\\0")
        .filter(Boolean)
    : status.untrackedPaths;
  const supplemental = countAddedLines(repositoryRoot, supplementalPaths);

  return {
    isGit: true,
    repositoryRoot,
    branch: status.branch,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    changedFiles: status.changedFiles,
    additions: numstat.additions + supplemental.additions,
    deletions: numstat.deletions,
    lineStatsComplete: numstat.complete && supplemental.complete,
    files: status.files,
  };
}
`;

export const AGENT_WORKSPACE_GIT_PROBE_SCRIPT = `
${AGENT_WORKSPACE_GIT_INSPECTION}
try {
  process.stdout.write(JSON.stringify(inspectWorkspace(process.cwd())));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
}
`.trim();

// Pushes a status line whenever the workspace changes. Change discovery is
// filesystem events with a debounce and a minimum gap between inspections;
// polling only covers missed events (slowly) or hosts where watching fails
// (with backoff while nothing changes). The process exits when its stdin
// closes, so a dropped connector or SSH session never strands it.
export const AGENT_WORKSPACE_GIT_WATCH_SCRIPT = `
${AGENT_WORKSPACE_GIT_INSPECTION}
const DEBOUNCE_MS = 1000;
const MAX_DELAY_MS = 3000;
const MIN_GAP_MS = 2000;
const SAFETY_POLL_MS = 60000;
const DEGRADED_POLL_BASE_MS = 5000;
const DEGRADED_POLL_MAX_MS = 60000;
const MAX_WATCHED_DIRECTORIES = 4000;
const MAX_IGNORED_ENTRIES = 20000;
const GIT_METADATA = new Set([
  "HEAD",
  "index",
  "packed-refs",
  "FETCH_HEAD",
  "ORIG_HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
]);
const recursiveWatch = process.platform === "darwin" || process.platform === "win32";
const root = process.cwd();

let repository = null;
let ignoredDirectories = [];
let ignoredFiles = new Set();
let watchers = new Map();
let degraded = false;
let lastPayload = null;
let lastError = null;
let refreshTimer = null;
let pollTimer = null;
let firstEventAt = 0;
let lastRunAt = 0;
let pollDelay = DEGRADED_POLL_BASE_MS;

function emit(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

function withSeparator(directory) {
  return directory.endsWith(path.sep) ? directory : directory + path.sep;
}

function within(file, directory) {
  return file === directory || file.startsWith(withSeparator(directory));
}

function locateRepository() {
  try {
    const [top, gitDir, commonDir] = runGit(
      ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
      root,
    ).split("\\n");
    if (!top || !gitDir || !commonDir) return null;
    return {
      top: path.resolve(top),
      gitDir: path.resolve(gitDir),
      commonDir: path.resolve(root, commonDir),
    };
  } catch {
    return null;
  }
}

function loadIgnored() {
  ignoredDirectories = [];
  ignoredFiles = new Set();
  if (!repository) return;
  let entries;
  try {
    entries = runGit(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      root,
    ).split("\\0").filter(Boolean);
  } catch {
    return;
  }
  if (entries.length > MAX_IGNORED_ENTRIES) return;
  for (const entry of entries) {
    const absolute = path.resolve(root, entry);
    if (entry.endsWith("/")) ignoredDirectories.push(absolute);
    else ignoredFiles.add(absolute);
  }
}

function relevant(file) {
  if (file === null) return true;
  if (repository) {
    for (const directory of [repository.gitDir, repository.commonDir]) {
      if (!within(file, directory)) continue;
      const relative = path.relative(directory, file).split(path.sep).join("/");
      if (relative.endsWith(".lock")) return false;
      return GIT_METADATA.has(relative) || relative.startsWith("refs/");
    }
  }
  if (ignoredFiles.has(file)) return false;
  return !ignoredDirectories.some((directory) => within(file, directory));
}

function closeWatchers() {
  for (const watcher of watchers.values()) {
    try { watcher.close(); } catch {}
  }
  watchers = new Map();
}

function watchDirectory(directory, recursive, skip = skipWorktreeDirectory) {
  if (watchers.has(directory)) return true;
  if (watchers.size >= MAX_WATCHED_DIRECTORIES) return false;
  let watcher;
  try {
    watcher = fs.watch(directory, { recursive, persistent: true }, (eventType, filename) => {
      const file = filename ? path.join(directory, String(filename)) : null;
      if (!recursive && eventType === "rename" && file && !watchers.has(file)) {
        watchNewDirectory(file, skip);
      }
      if (file && path.basename(file) === ".gitignore") loadIgnored();
      if (relevant(file)) scheduleRefresh();
    });
  } catch {
    return false;
  }
  watcher.on("error", () => {
    try { watcher.close(); } catch {}
    if (watchers.get(directory) === watcher) watchers.delete(directory);
  });
  watchers.set(directory, watcher);
  return true;
}

function skipWorktreeDirectory(directory) {
  if (!repository) return false;
  if (within(directory, repository.gitDir) || within(directory, repository.commonDir)) {
    return true;
  }
  return !relevant(directory);
}

function walkDirectories(start, skip = skipWorktreeDirectory) {
  const stack = [start];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (skip(directory)) continue;
    if (!watchDirectory(directory, false, skip)) return false;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(directory, entry.name));
    }
  }
  return true;
}

function watchNewDirectory(file, skip) {
  try {
    if (!fs.lstatSync(file).isDirectory()) return;
  } catch {
    return;
  }
  if (!walkDirectories(file, skip)) degrade();
}

function skipNothing() {
  return false;
}

function degrade() {
  if (degraded) return;
  degraded = true;
  closeWatchers();
  watchMetadata();
}

function watchMetadata() {
  if (!repository) return;
  const directories = new Set([
    repository.gitDir,
    repository.commonDir,
    path.join(repository.commonDir, "refs"),
  ]);
  for (const directory of directories) {
    if (recursiveWatch && directory.endsWith(path.sep + "refs")) {
      watchDirectory(directory, true);
    } else if (directory.endsWith(path.sep + "refs")) {
      walkDirectories(directory, skipNothing);
    } else {
      watchDirectory(directory, false, skipNothing);
    }
  }
}

function rebuildWatchers() {
  closeWatchers();
  degraded = false;
  repository = locateRepository();
  loadIgnored();
  let watched;
  if (recursiveWatch) {
    watched = watchDirectory(root, true);
  } else {
    watched = walkDirectories(root);
  }
  if (!watched) {
    degraded = true;
    closeWatchers();
  }
  watchMetadata();
}

function refresh() {
  refreshTimer = null;
  firstEventAt = 0;
  lastRunAt = Date.now();
  let changed = false;
  try {
    const payload = JSON.stringify(inspectWorkspace(root));
    if (payload !== lastPayload) {
      const repositoryChanged = lastPayload !== null &&
        JSON.parse(lastPayload).repositoryRoot !== JSON.parse(payload).repositoryRoot;
      lastPayload = payload;
      lastError = null;
      changed = true;
      process.stdout.write('{"type":"status","status":' + payload + "}\\n");
      if (repositoryChanged) rebuildWatchers();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) {
      lastError = message;
      lastPayload = null;
      changed = true;
      emit({ type: "error", message });
    }
  }
  pollDelay = changed
    ? DEGRADED_POLL_BASE_MS
    : Math.min(pollDelay * 2, DEGRADED_POLL_MAX_MS);
  schedulePoll();
}

function scheduleRefresh() {
  const now = Date.now();
  if (!firstEventAt) firstEventAt = now;
  const due = Math.max(
    Math.min(now + DEBOUNCE_MS, firstEventAt + MAX_DELAY_MS),
    lastRunAt + MIN_GAP_MS,
  );
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, Math.max(0, due - now));
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (refreshTimer) schedulePoll();
    else refresh();
  }, degraded || !repository ? pollDelay : SAFETY_POLL_MS);
}

process.stdout.on("error", () => process.exit(0));
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdin.resume();
rebuildWatchers();
refresh();
`.trim();

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableCount(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0)
  );
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function parseGitProbe(value: unknown): AgentWorkspaceGitStatus {
  if (!value || typeof value !== "object") {
    throw new Error("The remote machine returned invalid Git metadata.");
  }
  if (Reflect.get(value, "isGit") === false) {
    return {
      isGit: false,
      repositoryRoot: null,
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      dirty: false,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    };
  }

  const repositoryRoot = Reflect.get(value, "repositoryRoot");
  const branch = Reflect.get(value, "branch");
  const upstream = Reflect.get(value, "upstream");
  const ahead = Reflect.get(value, "ahead");
  const behind = Reflect.get(value, "behind");
  const changedFiles = Reflect.get(value, "changedFiles");
  const additions = Reflect.get(value, "additions");
  const deletions = Reflect.get(value, "deletions");
  const lineStatsComplete = Reflect.get(value, "lineStatsComplete");
  const files = Reflect.get(value, "files");
  if (
    Reflect.get(value, "isGit") !== true ||
    typeof repositoryRoot !== "string" ||
    !repositoryRoot ||
    !isNullableString(branch) ||
    !isNullableString(upstream) ||
    !isNullableCount(ahead) ||
    !isNullableCount(behind) ||
    !isCount(changedFiles) ||
    !isCount(additions) ||
    !isCount(deletions) ||
    typeof lineStatsComplete !== "boolean" ||
    !Array.isArray(files) ||
    !files.every(
      (file) =>
        file &&
        typeof file === "object" &&
        typeof Reflect.get(file, "path") === "string" &&
        isNullableString(Reflect.get(file, "originalPath")) &&
        isNullableString(Reflect.get(file, "indexStatus")) &&
        isNullableString(Reflect.get(file, "worktreeStatus")),
    )
  ) {
    throw new Error("The remote machine returned invalid Git metadata.");
  }

  return {
    isGit: true,
    repositoryRoot,
    branch,
    upstream,
    ahead,
    behind,
    dirty: changedFiles > 0,
    changedFiles,
    additions,
    deletions,
    lineStatsComplete,
    files: files.map((file) => ({
      path: Reflect.get(file, "path") as string,
      originalPath: Reflect.get(file, "originalPath") as string | null,
      indexStatus: Reflect.get(file, "indexStatus") as string | null,
      worktreeStatus: Reflect.get(file, "worktreeStatus") as string | null,
    })),
  };
}

export async function inspectAgentWorkspaceGitStatus(
  target: HostTarget,
  workspacePath: string,
): Promise<AgentWorkspaceGitStatus> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", AGENT_WORKSPACE_GIT_PROBE_SCRIPT],
    cwd: workspacePath,
  });
  return parseGitProbe(JSON.parse(result.stdout) as unknown);
}

export type AgentWorkspaceGitWatchHandlers = {
  status(status: AgentWorkspaceGitStatus): void;
  error(message: string): void;
};

export type AgentWorkspaceGitWatch = {
  /** Resolves when the watcher process has exited for any reason. */
  exited: Promise<void>;
  stop(): Promise<void>;
};

const MAX_WATCH_LINE_BYTES = 8 * 1024 * 1024;
const WATCH_STOP_GRACE_MS = 5_000;

export function watchAgentWorkspaceGitStatus(
  target: HostTarget,
  workspacePath: string,
  handlers: AgentWorkspaceGitWatchHandlers,
): AgentWorkspaceGitWatch {
  const child = spawnOnHost(target, {
    command: "node",
    args: ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT],
    cwd: workspacePath,
  });
  let stopped = false;
  let buffered = "";
  const decoder = new TextDecoder();
  const receive = (line: string) => {
    if (stopped || !line) return;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      handlers.error("The Git watcher returned invalid output.");
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Reflect.get(value, "type") === "status") {
      try {
        handlers.status(parseGitProbe(Reflect.get(value, "status")));
      } catch (error) {
        handlers.error(error instanceof Error ? error.message : String(error));
      }
    } else if (Reflect.get(value, "type") === "error") {
      handlers.error(String(Reflect.get(value, "message")));
    }
  };
  child.stdout.on("data", (chunk: Buffer | string) => {
    buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      receive(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
    if (buffered.length > MAX_WATCH_LINE_BYTES) {
      buffered = "";
      handlers.error("The Git watcher output exceeded its limit.");
      child.kill("SIGKILL");
    }
  });
  // Drain stderr so a chatty login shell cannot block the watcher.
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});
  const exited = child.exit.then(() => undefined);
  return {
    exited,
    async stop() {
      if (stopped) return exited;
      stopped = true;
      child.stdin.end();
      if (child.terminate) await child.terminate();
      else child.kill("SIGTERM");
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, WATCH_STOP_GRACE_MS);
          timer.unref();
        }),
      ]);
      if (timer) clearTimeout(timer);
    },
  };
}
