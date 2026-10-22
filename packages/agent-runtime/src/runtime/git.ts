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
const { spawn } = require("node:child_process");

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 4 * 1024 * 1024;
// One host process can inspect many workspaces; bound the Git processes it
// runs at once so a burst of refreshes cannot flood the machine.
const MAX_GIT_PROCESSES = 8;

let runningGitProcesses = 0;
const waitingGitProcesses = [];

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const run = () => {
      runningGitProcesses += 1;
      let settled = false;
      const finish = (error, output) => {
        if (settled) return;
        settled = true;
        runningGitProcesses -= 1;
        const next = waitingGitProcesses.shift();
        if (next) next();
        if (error) reject(error);
        else resolve(output);
      };
      let child;
      try {
        child = spawn("git", args, {
          cwd,
          // Status must not refresh the index: that write would race the
          // agent's own Git commands for index.lock and wake the watcher in a
          // loop.
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        finish(error);
        return;
      }
      const stdout = [];
      let stdoutBytes = 0;
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
          child.kill();
          finish(new Error("Git returned more output than the status limit allows."));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 65536) stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (error && error.code === "ENOENT") {
          finish(new Error(
            fs.existsSync(cwd)
              ? "Git is not installed on the selected machine."
              : "The workspace directory is not available on the selected machine.",
          ));
          return;
        }
        finish(error);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          finish(new Error(stderr.trim() || "Git exited with code " + String(code)));
          return;
        }
        finish(null, Buffer.concat(stdout).toString("utf8"));
      });
    };
    if (runningGitProcesses < MAX_GIT_PROCESSES) run();
    else waitingGitProcesses.push(run);
  });
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

async function countAddedLines(repositoryRoot, relativePaths) {
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
      const stat = await fs.promises.lstat(absolutePath);
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
      const content = await fs.promises.readFile(absolutePath);
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

async function inspectWorkspace(cwd) {
  let repositoryRoot;
  try {
    repositoryRoot = (await runGit(["rev-parse", "--show-toplevel"], cwd)).trim();
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

  const rawStatus = await runGit(
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
    : await runGit(
        ["diff", "--numstat", "-z", "HEAD", "--", workspacePathspec],
        repositoryRoot,
      );
  const numstat = parseNumstat(rawNumstat);
  const supplementalPaths = status.initial
    ? (await runGit(
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", workspacePathspec],
        repositoryRoot,
      ))
        .split("\\0")
        .filter(Boolean)
    : status.untrackedPaths;
  const supplemental = await countAddedLines(repositoryRoot, supplementalPaths);

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
inspectWorkspace(process.cwd()).then(
  (result) => process.stdout.write(JSON.stringify(result)),
  (error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
`.trim();

// One long-lived process per host watches every workspace the connector asks
// for. Each workspace pushes a status line only when its status changes.
// Change discovery is filesystem events with a debounce and a minimum gap
// between inspections; polling only covers missed events (slowly) or hosts
// where watching fails (with backoff while nothing changes). A canary file in
// the Git directory proves each watch actually delivers events before it is
// trusted. The process exits when its stdin closes, so a dropped connector or
// SSH session never strands it.
//
// Input lines:  {"type":"watch","id","path"} | {"type":"unwatch","id"}
// Output lines: {"type":"status","id","status"} | {"type":"error","id","message"}
export const AGENT_WORKSPACE_GIT_WATCH_SCRIPT = `
${AGENT_WORKSPACE_GIT_INSPECTION}
const crypto = require("node:crypto");

const DEBOUNCE_MS = 1000;
const MAX_DELAY_MS = 3000;
const MIN_GAP_MS = 2000;
const SAFETY_POLL_MS = 60000;
const DEGRADED_POLL_BASE_MS = 5000;
const DEGRADED_POLL_MAX_MS = 60000;
const RECOVERY_BASE_MS = 30000;
const RECOVERY_MAX_MS = 300000;
const CANARY_TIMEOUT_MS = 10000;
const MAX_WATCHED_DIRECTORIES = 5000;
const MAX_IGNORED_ENTRIES = 20000;
// Inspections and watch setup (directory walks) share this process, so a
// large or slow repository must not hold up every other workspace.
const REFRESH_CONCURRENCY = 4;
const SETUP_CONCURRENCY = 2;
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
const pendingCanaries = new Set();

function limit(concurrency) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= concurrency || queue.length === 0) return;
    running += 1;
    const job = queue.shift();
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        running -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

const refreshSlot = limit(REFRESH_CONCURRENCY);
const setupSlot = limit(SETUP_CONCURRENCY);

function emit(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

function withSeparator(directory) {
  return directory.endsWith(path.sep) ? directory : directory + path.sep;
}

function within(file, directory) {
  return file === directory || file.startsWith(withSeparator(directory));
}

function watchWorkspace(id, requestedPath) {
  let closed = false;
  let root = null;
  let repository = null;
  let ignoredDirectories = [];
  let ignoredFiles = new Set();
  let watchers = new Map();
  let generation = 0;
  let degraded = false;
  let broken = false;
  let canary = null;
  let establishedAt = 0;
  let recoveryAttempt = 0;
  let recoveryTimer = null;
  let startTimer = null;
  let lastPayload = null;
  let lastError = null;
  let refreshTimer = null;
  let pollTimer = null;
  let refreshing = false;
  let refreshAgain = false;
  let firstEventAt = 0;
  let lastRunAt = 0;
  let pollDelay = DEGRADED_POLL_BASE_MS;

  function reportError(message) {
    if (message === lastError) return;
    lastError = message;
    lastPayload = null;
    emit({ type: "error", id, message });
  }

  async function locateRepository() {
    try {
      const [top, gitDir, commonDir] = (await runGit(
        ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
        root,
      )).split("\\n");
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

  async function loadIgnored() {
    const directories = [];
    const files = new Set();
    if (repository) {
      let entries = [];
      try {
        entries = (await runGit(
          ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
          root,
        )).split("\\0").filter(Boolean);
      } catch {}
      if (entries.length <= MAX_IGNORED_ENTRIES) {
        for (const entry of entries) {
          const absolute = path.resolve(root, entry);
          if (entry.endsWith("/")) directories.push(absolute);
          else files.add(absolute);
        }
      }
    }
    ignoredDirectories = directories;
    ignoredFiles = files;
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
    if (closed) return false;
    if (watchers.has(directory)) return true;
    if (watchers.size >= MAX_WATCHED_DIRECTORIES) return false;
    let watcher;
    try {
      watcher = fs.watch(directory, { recursive, persistent: true }, (eventType, filename) => {
        if (closed || watchers.get(directory) !== watcher) return;
        const file = filename ? path.join(directory, String(filename)) : null;
        if (canary && file && path.basename(file) === canary.name) {
          canary.report();
          return;
        }
        if (!recursive && eventType === "rename" && file && !watchers.has(file)) {
          void watchNewDirectory(file, skip);
        }
        if (file && path.basename(file) === ".gitignore") void loadIgnored();
        if (relevant(file)) scheduleRefresh();
      });
    } catch {
      return false;
    }
    watcher.on("error", () => {
      if (watchers.get(directory) !== watcher) return;
      try { watcher.close(); } catch {}
      watchers.delete(directory);
      // A removed directory needs no watch; any other failure means changes
      // may go unseen, so stop trusting events until the watch is rebuilt.
      if (fs.existsSync(directory)) fail();
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

  function skipNothing() {
    return false;
  }

  async function walkDirectories(start, skip, current) {
    const stack = [start];
    while (stack.length > 0) {
      if (closed || current !== generation) return true;
      const directory = stack.pop();
      if (skip(directory)) continue;
      if (!watchDirectory(directory, false, skip)) return false;
      let entries;
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) stack.push(path.join(directory, entry.name));
      }
    }
    return true;
  }

  async function watchNewDirectory(file, skip) {
    const current = generation;
    try {
      if (!(await fs.promises.lstat(file)).isDirectory()) return;
    } catch {
      return;
    }
    if (!(await walkDirectories(file, skip, current)) && current === generation) degrade();
  }

  // Too many directories to watch: keep the Git metadata watch and poll the
  // working tree.
  function degrade() {
    if (degraded || closed) return;
    degraded = true;
    closeWatchers();
    watchMetadata(generation);
    schedulePoll();
  }

  // A watch failed or never proved itself: poll everything and retry the
  // watch later with backoff.
  function fail() {
    if (broken || closed) return;
    broken = true;
    degraded = true;
    generation += 1;
    canary = null;
    closeWatchers();
    if (establishedAt && Date.now() - establishedAt >= RECOVERY_MAX_MS) {
      recoveryAttempt = 0;
    }
    const delay = Math.min(RECOVERY_BASE_MS * 2 ** recoveryAttempt, RECOVERY_MAX_MS);
    recoveryAttempt += 1;
    pollDelay = DEGRADED_POLL_BASE_MS;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void rebuildWatchers();
    }, delay);
    schedulePoll();
  }

  function watchMetadata(current) {
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
        void walkDirectories(directory, skipNothing, current);
      } else {
        watchDirectory(directory, false, skipNothing);
      }
    }
  }

  async function verifyCanary() {
    const name = ".overtchat-watcher-canary-" + crypto.randomUUID();
    const file = path.join(repository.commonDir, name);
    let report;
    const reported = new Promise((resolve) => {
      report = () => resolve(true);
    });
    canary = { name, report };
    pendingCanaries.add(file);
    let timer;
    try {
      await fs.promises.writeFile(file, "overtchat watcher liveness canary\\n", { flag: "wx" });
      return await Promise.race([
        reported,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), CANARY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      if (canary && canary.name === name) canary = null;
      await fs.promises.rm(file, { force: true }).catch(() => {});
      pendingCanaries.delete(file);
    }
  }

  async function rebuildWatchers() {
    const current = ++generation;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    const ready = await setupSlot(async () => {
      if (closed || current !== generation) return false;
      closeWatchers();
      degraded = false;
      broken = false;
      repository = await locateRepository();
      if (closed || current !== generation) return false;
      await loadIgnored();
      if (closed || current !== generation) return false;
      const watched = recursiveWatch
        ? watchDirectory(root, true)
        : await walkDirectories(root, skipWorktreeDirectory, current);
      if (closed || current !== generation) return false;
      if (!watched) {
        degraded = true;
        closeWatchers();
      }
      watchMetadata(current);
      return true;
    });
    if (!ready) return;
    if (repository && !(await verifyCanary())) {
      if (!closed && current === generation) fail();
      return;
    }
    if (closed || current !== generation) return;
    establishedAt = Date.now();
    // Catch anything that changed while the watch was being set up.
    scheduleRefresh();
  }

  function refresh() {
    refreshTimer = null;
    if (closed) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    firstEventAt = 0;
    void refreshSlot(async () => {
      if (closed) return;
      let changed = false;
      try {
        const payload = JSON.stringify(await inspectWorkspace(root));
        if (closed) return;
        if (payload !== lastPayload) {
          const repositoryChanged = lastPayload !== null &&
            JSON.parse(lastPayload).repositoryRoot !== JSON.parse(payload).repositoryRoot;
          lastPayload = payload;
          lastError = null;
          changed = true;
          process.stdout.write(
            '{"type":"status","id":' + JSON.stringify(id) + ',"status":' + payload + "}\\n",
          );
          if (repositoryChanged) void rebuildWatchers();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        changed = message !== lastError;
        reportError(message);
      }
      pollDelay = changed
        ? DEGRADED_POLL_BASE_MS
        : Math.min(pollDelay * 2, DEGRADED_POLL_MAX_MS);
    }).finally(() => {
      refreshing = false;
      lastRunAt = Date.now();
      if (closed) return;
      if (refreshAgain) {
        refreshAgain = false;
        scheduleRefresh();
      }
      schedulePoll();
    });
  }

  function scheduleRefresh() {
    if (closed) return;
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
    if (closed) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (refreshTimer || refreshing) schedulePoll();
      else refresh();
    }, degraded || !repository ? pollDelay : SAFETY_POLL_MS);
  }

  async function start() {
    startTimer = null;
    try {
      // Watch and compare the resolved path, which is what Git reports.
      root = await fs.promises.realpath(requestedPath);
    } catch {
      if (closed) return;
      reportError("The workspace directory is not available on the selected machine.");
      startTimer = setTimeout(start, pollDelay);
      pollDelay = Math.min(pollDelay * 2, DEGRADED_POLL_MAX_MS);
      return;
    }
    if (closed) return;
    pollDelay = DEGRADED_POLL_BASE_MS;
    refresh();
    void rebuildWatchers();
  }

  void start();
  return {
    close() {
      closed = true;
      generation += 1;
      canary = null;
      closeWatchers();
      for (const timer of [refreshTimer, pollTimer, recoveryTimer, startTimer]) {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

const workspaces = new Map();
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let newline = input.indexOf("\\n");
  while (newline >= 0) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    newline = input.indexOf("\\n");
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      continue;
    }
    if (!command || typeof command.id !== "string") continue;
    const existing = workspaces.get(command.id);
    if (existing) existing.close();
    workspaces.delete(command.id);
    if (command.type === "watch" && typeof command.path === "string") {
      workspaces.set(command.id, watchWorkspace(command.id, command.path));
    }
  }
});
process.stdout.on("error", () => process.exit(0));
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.on("exit", () => {
  for (const file of pendingCanaries) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
});
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

export type AgentWorkspaceGitHostWatcherHandlers = {
  status(id: string, status: AgentWorkspaceGitStatus): void;
  error(id: string, message: string): void;
};

export type AgentWorkspaceGitHostWatcher = {
  watch(id: string, workspacePath: string): void;
  unwatch(id: string): void;
  /** Resolves when the watcher process has exited for any reason. */
  exited: Promise<void>;
  stop(): Promise<void>;
};

const MAX_WATCH_LINE_BYTES = 8 * 1024 * 1024;
const WATCH_STOP_GRACE_MS = 5_000;

/** Starts the one watcher process that serves every watched workspace on a host. */
export function startAgentWorkspaceGitHostWatcher(
  target: HostTarget,
  handlers: AgentWorkspaceGitHostWatcherHandlers,
): AgentWorkspaceGitHostWatcher {
  const child = spawnOnHost(target, {
    command: "node",
    args: ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT],
  });
  let stopped = false;
  let buffered = "";
  const decoder = new TextDecoder();
  const send = (command: Record<string, string>) => {
    if (stopped || !child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(command)}\n`);
  };
  const receive = (line: string) => {
    if (stopped || !line) return;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      // The protocol is unusable; the owner restarts the process.
      child.kill("SIGKILL");
      return;
    }
    if (!value || typeof value !== "object") return;
    const id = Reflect.get(value, "id");
    if (typeof id !== "string") return;
    if (Reflect.get(value, "type") === "status") {
      try {
        handlers.status(id, parseGitProbe(Reflect.get(value, "status")));
      } catch (error) {
        handlers.error(id, error instanceof Error ? error.message : String(error));
      }
    } else if (Reflect.get(value, "type") === "error") {
      handlers.error(id, String(Reflect.get(value, "message")));
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
      child.kill("SIGKILL");
    }
  });
  // Drain stderr so a chatty login shell cannot block the watcher.
  child.stderr.on("data", () => {});
  child.stdin.on("error", () => {});
  const exited = child.exit.then(() => undefined);
  return {
    exited,
    watch(id, workspacePath) {
      send({ type: "watch", id, path: workspacePath });
    },
    unwatch(id) {
      send({ type: "unwatch", id });
    },
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
