import { createHash } from "node:crypto";
import {
  AGENT_TURN_CHANGES_MAX_FILES,
  agentTurnChangesSchema,
  type AgentTurnChanges,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

// What a turn changed is the difference between two snapshots of the working
// tree: one from before the turn and one from after it. A snapshot is a commit
// under refs/overtchat/turns/<session>/<n>, built in a scratch index so the
// user's index, branches, and working tree are never touched. Pre-existing
// uncommitted work is in both snapshots and cancels out; anything a command
// or formatter wrote during the turn is counted like an edit.
//
// Runs under the host's own Node so local, SSH, and Windows targets execute
// identical code. Arguments: action (probe, baseline, capture, delete),
// comma-separated session keys, budget in milliseconds. Prints one JSON result.
export const AGENT_TURN_CHANGES_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const action = process.argv[1];
const sessionKeys = (process.argv[2] || "")
  .split(",")
  .filter((key) => /^[0-9a-f]{32}$/.test(key));
const budgetMs = Number(process.argv[3]) || 30000;
const cwd = process.cwd();

const GIT_TIMEOUT_MS = 30000;
const MAX_DIFF_OUTPUT_BYTES = 10 * 1000 * 1000;
const MAX_LIST_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_FILES = ${AGENT_TURN_CHANGES_MAX_FILES};
const MAX_NESTED_REPOSITORIES = 64;
const NESTED_REPOSITORY_TIMEOUT_MS = 5000;
// A scratch split index can expire shared index files the real index uses.
const INDEX_CONFIG = [
  "-c", "core.fsmonitor=false",
  "-c", "sparse.expectFilesOutsideOfPatterns=false",
  "-c", "core.splitIndex=false",
  "-c", "splitIndex.sharedIndexExpire=never",
];
// A crash must not leave a ref pointing at objects that were never flushed.
const DURABLE_WRITE = [
  "-c", "core.fsync=objects,reference",
  "-c", "core.fsyncMethod=fsync",
  ...(process.platform === "darwin" || process.platform === "win32"
    ? ["-c", "core.fsyncMethod=batch"]
    : []),
];
const LONG_PATHS = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];
const IDENTITY = {
  GIT_AUTHOR_NAME: "OvertChat",
  GIT_AUTHOR_EMAIL: "noreply@overtchat.com",
  GIT_COMMITTER_NAME: "OvertChat",
  GIT_COMMITTER_EMAIL: "noreply@overtchat.com",
};

class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const children = new Set();
let expired = false;
const deadline = setTimeout(() => {
  expired = true;
  for (const child of children) child.kill("SIGKILL");
}, budgetMs);

function runGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    if (expired) {
      reject(new Error("timeout"));
      return;
    }
    let child;
    try {
      child = spawn("git", args, {
        cwd: options.cwd || cwd,
        env: options.env || process.env,
        stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    children.add(child);
    const limit = options.maxBytes || MAX_LIST_OUTPUT_BYTES;
    const stdout = [];
    let bytes = 0;
    let stderr = "";
    let failure = null;
    let settled = false;
    const timer = setTimeout(() => {
      failure = new Error("timeout");
      child.kill("SIGKILL");
    }, GIT_TIMEOUT_MS);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        failure = new Error("Git returned more output than the limit allows.");
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65536) stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    // A killed command can leave a descendant holding its pipes open, so a
    // failure does not wait for them to close.
    child.on("exit", () => {
      if (expired) finish(new Error("timeout"));
      else if (failure) finish(failure);
    });
    child.on("close", (code) => {
      if (expired) finish(new Error("timeout"));
      else if (failure) finish(failure);
      else if (code !== 0 && !options.allowFailure) {
        finish(new Error(stderr.trim() || "Git exited with code " + String(code)));
      } else {
        finish(null, { code, stdout: Buffer.concat(stdout).toString("utf8") });
      }
    });
    if (options.stdin !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    }
  });
}

async function resolveRepository() {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (inside.code !== 0 || inside.stdout.trim() !== "true") throw new Skip("not-git");
  const line = async (args) =>
    (await runGit(["rev-parse", ...args])).stdout.replace(/\\r?\\n$/, "");
  const gitCommonDir = path.resolve(cwd, await line(["--git-common-dir"]));
  const indexPath = path.resolve(cwd, await line(["--git-path", "index"]));
  const prefix = await line(["--show-prefix"]);
  const head = await runGit(
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    { allowFailure: true },
  );
  return { gitCommonDir, indexPath, prefix, headExists: head.code === 0 };
}

function refPrefix(key) {
  return "refs/overtchat/turns/" + key + "/";
}

async function sessionSnapshots(key) {
  const output = (await runGit([
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    refPrefix(key),
  ])).stdout;
  return output
    .split("\\n")
    .flatMap((line) => {
      const [ref = "", oid = ""] = line.trim().split(" ");
      const ordinal = Number(ref.slice(ref.lastIndexOf("/") + 1));
      return ref && oid && Number.isSafeInteger(ordinal) && ordinal >= 0
        ? [{ ref, oid, ordinal }]
        : [];
    })
    .sort((left, right) => left.ordinal - right.ordinal);
}

// Git cannot stage an embedded repository that has no commit yet.
async function nestedRepositoryExclusions(env) {
  const started = Date.now();
  const untracked = await runGit(
    [...LONG_PATHS, "ls-files", "--others", "--exclude-standard", "-z", "--", "."],
    { env },
  );
  const candidates = untracked.stdout.split("\\0").filter((entry) => entry.endsWith("/"));
  if (candidates.length > MAX_NESTED_REPOSITORIES) return [];
  const nestedEnv = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) delete nestedEnv[name];
  const exclusions = [];
  for (const entry of candidates) {
    if (Date.now() - started > NESTED_REPOSITORY_TIMEOUT_MS) return [];
    const nested = path.join(cwd, entry);
    if (!fs.existsSync(path.join(nested, ".git"))) continue;
    const head = await runGit(
      ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      { cwd: nested, env: nestedEnv, allowFailure: true },
    );
    if (head.code !== 0) exclusions.push(":(exclude,literal)" + entry);
  }
  return exclusions;
}

async function capture(repository, ref) {
  const sparse = await runGit(["config", "--bool", "core.sparseCheckout"], { allowFailure: true });
  if (sparse.stdout.trim() === "true") throw new Skip("sparse-checkout");
  if (repository.prefix !== "") {
    // The working tree's root is never ignored; a workspace below it can be.
    const directory = "../" + repository.prefix.replace(/\\/$/, "").split("/").pop();
    const ignored = await runGit(["check-ignore", "-q", "--", directory], { allowFailure: true });
    if (ignored.code === 0) throw new Skip("ignored-workspace");
  }

  const scratchIndex = path.join(
    repository.gitCommonDir,
    "overtchat-turn-index-" + crypto.randomUUID(),
  );
  const env = { ...process.env, ...IDENTITY, GIT_INDEX_FILE: scratchIndex };
  const removeScratchIndex = () => {
    for (const file of [scratchIndex, scratchIndex + ".lock"]) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  };
  try {
    if (repository.headExists) {
      // Starting from a copy of the user's index keeps its stat cache, so only
      // files that changed are hashed again.
      let reused = false;
      try {
        // Stay below the source timestamp, preserving Git's racy-entry check.
        const indexTime = Math.floor((fs.statSync(repository.indexPath).mtimeMs - 1) / 1000);
        if (indexTime > 0) {
          fs.copyFileSync(repository.indexPath, scratchIndex);
          await runGit([...INDEX_CONFIG, "read-tree", "--reset", "HEAD"], { env });
          fs.utimesSync(scratchIndex, indexTime, indexTime);
          reused = true;
        }
      } catch (error) {
        if (expired) throw error;
      }
      if (!reused) {
        removeScratchIndex();
        await runGit([...INDEX_CONFIG, "read-tree", "HEAD"], { env });
      }
    }

    const stage = (exclusions) =>
      runGit(
        [
          ...INDEX_CONFIG,
          ...DURABLE_WRITE,
          ...LONG_PATHS,
          // safecrlf=true refuses LF files under CRLF conversion.
          "-c", "core.safecrlf=false",
          "add", "-A", "--", ".",
          ...exclusions,
        ],
        { env },
      );
    try {
      await stage([]);
    } catch (error) {
      if (expired) throw error;
      const exclusions = await nestedRepositoryExclusions(env).catch(() => []);
      if (exclusions.length === 0) throw error;
      await stage(exclusions);
    }

    const tree = (await runGit([...INDEX_CONFIG, ...DURABLE_WRITE, "write-tree"], { env }))
      .stdout.trim();
    if (!tree) throw new Error("git write-tree returned no tree.");
    // HEAD is the parent so a later comparison can see how HEAD moved.
    const commit = (await runGit(
      [
        ...DURABLE_WRITE,
        "commit-tree", tree,
        ...(repository.headExists ? ["-p", "HEAD"] : []),
        "-m", "overtchat turn snapshot ref=" + ref,
      ],
      { env },
    )).stdout.trim();
    if (!commit) throw new Error("git commit-tree returned no commit.");
    await runGit([...DURABLE_WRITE, "update-ref", ref, commit]);
    return commit;
  } finally {
    removeScratchIndex();
  }
}

async function changedFiles(base, head) {
  const output = (await runGit(
    [
      "-c", "diff.relative=false",
      "-c", "diff.suppressBlankEmpty=false",
      "diff", "--numstat", "-z",
      "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short",
      base + "^{commit}",
      head + "^{commit}",
    ],
    { maxBytes: MAX_DIFF_OUTPUT_BYTES },
  )).stdout;
  const records = output.split("\\0");
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const [additions, deletions, ...rest] = record.split("\\t");
    let filePath = rest.join("\\t");
    let previousPath;
    if (filePath === "") {
      // A rename lists its old and new paths as the next two records.
      previousPath = records[index + 1];
      filePath = records[index + 2] || "";
      index += 2;
    }
    if (!filePath) continue;
    files.push({
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      // Binary files report "-".
      additions: additions === "-" ? 0 : Number(additions) || 0,
      deletions: deletions === "-" ? 0 : Number(deletions) || 0,
    });
  }
  return files;
}

// When HEAD moved during the turn, a pull or rebase can change thousands of
// files the turn did not write. Only paths the turn left uncommitted, or that
// commits made since the first snapshot touched, count as its own.
async function authoredPaths(base, head) {
  const heads = (await runGit([
    "log", "--no-walk=unsorted", "--format=%P %ct",
    base + "^{commit}",
    head + "^{commit}",
  ])).stdout.trimEnd().split("\\n");
  const [startHead = "", capturedAt = ""] = (heads[0] || "").split(" ");
  const [endHead = ""] = (heads[1] || "").split(" ");
  if (startHead === "" || endHead === "" || startHead === endHead) return null;
  const listPaths = async (args) =>
    (await runGit(
      [
        "-c", "diff.relative=false",
        // log.showSignature would print verification text into the path list.
        "-c", "log.showSignature=false",
        ...args,
        "--name-only", "-z", "--no-renames", "--no-ext-diff",
      ],
      { maxBytes: MAX_DIFF_OUTPUT_BYTES },
    )).stdout.split("\\0");
  // Remerge diffs keep conflict resolutions and leave out clean upstream changes.
  const lists = await Promise.all([
    listPaths(["diff", startHead, base + "^{commit}"]),
    listPaths(["diff", endHead, head + "^{commit}"]),
    listPaths(["log", "--format=", "--diff-merges=remerge", endHead + ".." + startHead]),
    listPaths([
      "log", "--format=", "--diff-merges=remerge",
      "--since=@" + capturedAt,
      startHead + ".." + endHead,
    ]),
  ]);
  return new Set(lists.flat().filter((entry) => entry.length > 0));
}

async function main() {
  if (action === "delete") {
    await resolveRepository();
    const refs = [];
    for (const key of sessionKeys) {
      for (const snapshot of await sessionSnapshots(key)) refs.push(snapshot.ref);
    }
    if (refs.length > 0) {
      await runGit(
        ["update-ref", "--stdin"],
        { stdin: refs.map((ref) => "delete " + ref + "\\n").join("") },
      );
    }
    return { status: "ready", deleted: refs.length };
  }

  const key = sessionKeys[0];
  if (!key || !["probe", "baseline", "capture"].includes(action)) {
    throw new Error("Invalid turn snapshot request.");
  }
  const repository = await resolveRepository();
  const snapshots = await sessionSnapshots(key);
  // Read-only: whether an earlier run of this session left a snapshot.
  if (action === "probe") return { status: "ready", snapshots: snapshots.length };
  const latest = snapshots[snapshots.length - 1] || null;
  if (action === "baseline") {
    if (!latest) await capture(repository, refPrefix(key) + "0");
    return { status: "ready" };
  }

  const head = await capture(
    repository,
    refPrefix(key) + String(latest ? latest.ordinal + 1 : 0),
  );
  const empty = { files: 0, additions: 0, deletions: 0 };
  // Without an earlier snapshot there is nothing to compare this turn against.
  if (!latest) return { status: "ready", base: null, head, files: [], total: empty };
  let files = await changedFiles(latest.oid, head);
  if (files.length > 0) {
    const authored = await authoredPaths(latest.oid, head);
    if (authored) {
      files = files.filter((file) =>
        authored.has(file.path) ||
        (file.previousPath !== undefined && authored.has(file.previousPath)),
      );
    }
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    status: "ready",
    base: latest.oid,
    head,
    files: files.slice(0, MAX_FILES),
    total: files.reduce(
      (total, file) => ({
        files: total.files + 1,
        additions: total.additions + file.additions,
        deletions: total.deletions + file.deletions,
      }),
      empty,
    ),
  };
}

main()
  .catch((error) =>
    error instanceof Skip
      ? { status: "missing", reason: error.reason }
      : {
          status: "error",
          reason: expired ? "timeout" : String((error && error.message) || error),
        },
  )
  .then((result) => {
    clearTimeout(deadline);
    // Exit explicitly: a pipe a killed command left open would keep this
    // process alive.
    process.stdout.write(JSON.stringify(result), () => process.exit(0));
  });
`.trim();

// A first snapshot holds the prompt back, so it gets little time. The process
// limit sits above the script's own so the script can clean up after itself.
const BASELINE_BUDGET_MS = 4_000;
const BASELINE_TIMEOUT_MS = 5_000;
const CAPTURE_BUDGET_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 32_000;
const DELETE_BUDGET_MS = 5_000;
const DELETE_TIMEOUT_MS = 7_000;
const DELETE_BATCH = 200;

type ScriptResult =
  | { status: "ready"; changes: AgentTurnChanges | null; snapshots: number }
  | { status: "missing" }
  | { status: "error"; reason: string };

/** Snapshot refs are keyed by a digest, so a session ID never shapes a ref name. */
export function agentTurnSnapshotKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function parseResult(stdout: string): ScriptResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    return { status: "error", reason: "invalid" };
  }
  if (!value || typeof value !== "object") {
    return { status: "error", reason: "invalid" };
  }
  const status = Reflect.get(value, "status");
  if (status === "missing") return { status: "missing" };
  if (status !== "ready") {
    const reason = Reflect.get(value, "reason");
    return {
      status: "error",
      reason: typeof reason === "string" ? reason : "invalid",
    };
  }
  const changes = agentTurnChangesSchema.safeParse(value);
  const snapshots = Reflect.get(value, "snapshots");
  return {
    status: "ready",
    changes:
      changes.success && changes.data.files.length > 0 ? changes.data : null,
    snapshots: typeof snapshots === "number" ? snapshots : 0,
  };
}

async function run(
  target: HostTarget,
  cwd: string,
  action: "probe" | "baseline" | "capture" | "delete",
  keys: readonly string[],
  budgetMs: number,
  timeoutMs: number,
): Promise<ScriptResult> {
  try {
    const result = await executeOnHost(
      target,
      {
        command: "node",
        args: [
          "-e",
          AGENT_TURN_CHANGES_SCRIPT,
          action,
          keys.join(","),
          String(budgetMs),
        ],
        cwd,
      },
      { timeoutMs },
    );
    return parseResult(result.stdout);
  } catch (error) {
    return {
      status: "error",
      reason:
        error instanceof Error && /timed out/i.test(error.message)
          ? "timeout"
          : "failed",
    };
  }
}

export type AgentTurnChangeTracker = {
  /** When a session opens: looks, without writing, for an earlier snapshot, so
   * the first prompt seldom has to wait for one. */
  warm(): Promise<void>;
  /** Before a prompt: makes sure a snapshot exists to compare the turn against. */
  prepare(): Promise<void>;
  /** After a turn: snapshots the workspace and reports what the turn changed. */
  finish(): Promise<AgentTurnChanges | null>;
};

export type AgentTurnChangeTrackerOptions = {
  baselineBudgetMs?: number;
  captureBudgetMs?: number;
};

/**
 * Tracks what each turn of one session changes in its workspace. Neither call
 * rejects: a workspace that cannot be snapshotted simply reports no changes.
 */
export function createAgentTurnChangeTracker(
  target: HostTarget,
  cwd: string,
  sessionId: string,
  options: AgentTurnChangeTrackerOptions = {},
): AgentTurnChangeTracker {
  const key = agentTurnSnapshotKey(sessionId);
  const baselineBudgetMs = options.baselineBudgetMs ?? BASELINE_BUDGET_MS;
  const captureBudgetMs = options.captureBudgetMs ?? CAPTURE_BUDGET_MS;
  // A folder that is not a repository stays one for this runtime's life, and a
  // repository too slow to snapshot would hold every later turn open.
  let disabled = false;
  let hasSnapshot = false;
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => {});
    return next;
  };

  return {
    warm: () =>
      serialized(async () => {
        if (disabled || hasSnapshot) return;
        const result = await run(
          target,
          cwd,
          "probe",
          [key],
          baselineBudgetMs,
          baselineBudgetMs + (BASELINE_TIMEOUT_MS - BASELINE_BUDGET_MS),
        );
        if (result.status === "ready") hasSnapshot = result.snapshots > 0;
        else if (result.status === "missing") disabled = true;
      }),
    prepare: () =>
      serialized(async () => {
        if (disabled || hasSnapshot) return;
        const result = await run(
          target,
          cwd,
          "baseline",
          [key],
          baselineBudgetMs,
          baselineBudgetMs + (BASELINE_TIMEOUT_MS - BASELINE_BUDGET_MS),
        );
        if (result.status === "ready") hasSnapshot = true;
        else if (result.status === "missing") disabled = true;
      }),
    finish: () =>
      serialized(async () => {
        if (disabled) return null;
        const result = await run(
          target,
          cwd,
          "capture",
          [key],
          captureBudgetMs,
          captureBudgetMs + (CAPTURE_TIMEOUT_MS - CAPTURE_BUDGET_MS),
        );
        if (result.status === "ready") {
          hasSnapshot = true;
          return result.changes;
        }
        if (result.status === "missing" || result.reason === "timeout") {
          disabled = true;
        }
        return null;
      }),
  };
}

/** Removes the snapshots of deleted sessions from a workspace's repository. */
export async function deleteAgentTurnSnapshots(
  target: HostTarget,
  cwd: string,
  sessionIds: readonly string[],
): Promise<void> {
  const keys = sessionIds.map(agentTurnSnapshotKey);
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    await run(
      target,
      cwd,
      "delete",
      keys.slice(start, start + DELETE_BATCH),
      DELETE_BUDGET_MS,
      DELETE_TIMEOUT_MS,
    );
  }
}
