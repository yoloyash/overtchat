import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

export const AGENT_WORKSPACE_GIT_PROBE_SCRIPT = `
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
      index += 1;
      continue;
    }
    if (
      record.startsWith("1 ") ||
      record.startsWith("u ") ||
      record.startsWith("? ")
    ) {
      changedFiles += 1;
      if (record.startsWith("? ")) {
        untrackedPaths.push(record.slice(2));
      }
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

function write(value) {
  process.stdout.write(JSON.stringify(value));
}

try {
  let repositoryRoot;
  try {
    repositoryRoot = runGit(
      ["rev-parse", "--show-toplevel"],
      process.cwd(),
    ).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository|must be run in a work tree/i.test(message)) {
      write({ isGit: false });
      process.exit(0);
    }
    throw error;
  }

  const rawStatus = runGit(
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ],
    repositoryRoot,
  );
  const status = parseStatus(rawStatus);
  const rawNumstat = status.initial
    ? ""
    : runGit(["diff", "--numstat", "-z", "HEAD", "--"], repositoryRoot);
  const numstat = parseNumstat(rawNumstat);
  const supplementalPaths = status.initial
    ? runGit(
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        repositoryRoot,
      )
        .split("\\0")
        .filter(Boolean)
    : status.untrackedPaths;
  const supplemental = countAddedLines(repositoryRoot, supplementalPaths);

  write({
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
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
}
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
    typeof lineStatsComplete !== "boolean"
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
