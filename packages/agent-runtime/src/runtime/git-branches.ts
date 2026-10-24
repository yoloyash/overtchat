import {
  isAgentWorkspaceGitBranches,
  isAgentWorkspaceGitSwitchResult,
  type AgentWorkspaceGitBranches,
  type AgentWorkspaceGitSwitchResult,
  type AgentWorkspaceGitSwitchTarget,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

// Like the status probe, these scripts run under the host's own Node so local,
// SSH, and Windows targets execute identical code. Input arrives on stdin so
// branch names never pass through a shell.
export const AGENT_WORKSPACE_GIT_COMMON = `
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
// Marks stashes made by a branch switch; Git prefixes the subject with
// "On <branch>: ", which identifies the branch the changes belong to.
const SWITCH_STASH_MESSAGE = "OvertChat branch switch";

function git(args, cwd, { readOnly = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          ...(readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
        },
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(String(stdout));
          return;
        }
        if (error.code === "ENOENT") {
          reject(new Error(
            fs.existsSync(cwd)
              ? "Git is not installed on the selected machine."
              : "The workspace directory is not available on the selected machine.",
          ));
          return;
        }
        reject(new Error(String(stderr).trim() || error.message));
      },
    );
  });
}

async function repositoryRoot(cwd) {
  try {
    return (await git(["rev-parse", "--show-toplevel"], cwd, { readOnly: true })).trim();
  } catch (error) {
    if (/not a git repository|must be run in a work tree/i.test(error.message)) return null;
    throw error;
  }
}

function readInput() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
    });
    process.stdin.on("error", reject);
  });
}

async function refExists(root, ref) {
  try {
    await git(["show-ref", "--verify", "--quiet", ref], root, { readOnly: true });
    return true;
  } catch {
    return false;
  }
}

async function currentBranch(root) {
  try {
    return (await git(["symbolic-ref", "--quiet", "--short", "HEAD"], root, { readOnly: true })).trim();
  } catch {
    return null;
  }
}

// Counts every change a checkout could carry or clobber, including untracked files.
async function changedFiles(root) {
  const records = (await git(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    root,
    { readOnly: true },
  )).split("\\0");
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    count += 1;
    // Renames and copies are followed by their original path.
    if (record[0] === "R" || record[0] === "C") index += 1;
  }
  return count;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function emit(promise) {
  promise.then(
    (result) => process.stdout.write(JSON.stringify(result)),
    (error) => {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
`;

const MAX_LISTED_BRANCHES = 500;

export const AGENT_WORKSPACE_GIT_BRANCHES_SCRIPT = `
${AGENT_WORKSPACE_GIT_COMMON}
const MAX_BRANCHES = ${MAX_LISTED_BRANCHES};

async function readRefs(root) {
  const fields = ["%(refname)", "%(HEAD)", "%(committerdate:unix)", "%(symref)"];
  const list = (format) =>
    git(
      ["for-each-ref", "--sort=-committerdate", "--format=" + format.join("%00"), "refs/heads", "refs/remotes"],
      root,
      { readOnly: true },
    );
  try {
    return await list([...fields, "%(worktreepath)"]);
  } catch (error) {
    // Git before 2.23 has no worktreepath field.
    if (!/worktreepath/.test(error.message)) throw error;
    return list(fields);
  }
}

async function listBranches(cwd) {
  const root = await repositoryRoot(cwd);
  if (root === null) return { isGit: false, current: null, branches: [], truncated: false };
  // Remote names may contain slashes; match the longest first.
  const remotes = (await git(["remote"], root, { readOnly: true }))
    .split(/\\r?\\n/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const local = [];
  const remote = [];
  let current = null;
  for (const line of (await readRefs(root)).split("\\n")) {
    if (!line) continue;
    const [ref, head, date, symref, worktree = ""] = line.split("\\0");
    if (symref) continue;
    const committedAt = /^\\d+$/.test(date) ? Number(date) * 1000 : null;
    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice("refs/heads/".length);
      const isCurrent = head === "*";
      if (isCurrent) current = name;
      local.push({
        name,
        remote: null,
        current: isCurrent,
        worktreePath: !isCurrent && worktree ? worktree : null,
        committedAt,
      });
    } else if (ref.startsWith("refs/remotes/")) {
      const rest = ref.slice("refs/remotes/".length);
      const remoteName = remotes.find((name) => rest.startsWith(name + "/"));
      const name = remoteName ? rest.slice(remoteName.length + 1) : "";
      if (!name) continue;
      remote.push({ name, remote: remoteName, current: false, worktreePath: null, committedAt });
    }
  }
  // A remote branch with a local counterpart is reached through the local one.
  const localNames = new Set(local.map((branch) => branch.name));
  const branches = [...local, ...remote.filter((branch) => !localNames.has(branch.name))];
  return {
    isGit: true,
    current,
    branches: branches.slice(0, MAX_BRANCHES),
    truncated: branches.length > MAX_BRANCHES,
  };
}

emit(listBranches(process.cwd()));
`.trim();

// Input: {"branch": AgentWorkspaceGitSwitchTarget, "stash": boolean, "busyPaths": string[]}
export const AGENT_WORKSPACE_GIT_SWITCH_SCRIPT = `
${AGENT_WORKSPACE_GIT_COMMON}
async function stashes(root) {
  const output = await git(["stash", "list", "--format=%gd%x00%H%x00%gs"], root, { readOnly: true });
  return output.split("\\n").filter(Boolean).map((line) => {
    const [ref, hash, subject] = line.split("\\0");
    return { ref, hash, subject };
  });
}

async function stashHead(root) {
  try {
    return (await git(["rev-parse", "--quiet", "--verify", "refs/stash"], root, { readOnly: true })).trim();
  } catch {
    return null;
  }
}

async function restoreStash(root, hash) {
  const entry = (await stashes(root)).find((stash) => stash.hash === hash);
  if (!entry) throw new Error("The stash is no longer available.");
  await git(["stash", "pop", "--index", entry.ref], root);
}

async function switchBranch(cwd, input) {
  const root = await repositoryRoot(cwd);
  if (root === null) throw new Error("The workspace is not a Git repository.");
  for (const busyPath of input.busyPaths) {
    const busyRoot = await repositoryRoot(busyPath).catch(() => null);
    if (busyRoot !== null && samePath(busyRoot, root)) return { status: "agent_running" };
  }

  const target = input.branch;
  const name = target.name;
  const unchanged = { status: "switched", branch: name, stashed: false, restored: false, keptStash: null };
  if (target.kind === "new") {
    await git(["check-ref-format", "--branch", name], root, { readOnly: true }).catch(() => {
      throw new Error(name + " is not a valid branch name.");
    });
    if (await refExists(root, "refs/heads/" + name)) {
      throw new Error("A branch named " + name + " already exists.");
    }
    // Creating a branch at HEAD changes no files, so uncommitted changes stay.
    await git(["checkout", "-b", name], root);
    return unchanged;
  }
  if (target.kind === "local") {
    if (!(await refExists(root, "refs/heads/" + name))) {
      throw new Error("The branch " + name + " no longer exists.");
    }
    if ((await currentBranch(root)) === name) return unchanged;
  } else {
    if (!(await refExists(root, "refs/remotes/" + target.remote + "/" + name))) {
      throw new Error("The branch " + target.remote + "/" + name + " no longer exists.");
    }
    if (await refExists(root, "refs/heads/" + name)) {
      throw new Error("A local branch named " + name + " already exists. Switch to it instead.");
    }
  }

  const changes = await changedFiles(root);
  let stashed = null;
  if (changes > 0) {
    if (!input.stash) return { status: "changes_present", changedFiles: changes };
    const before = await stashHead(root);
    await git(["stash", "push", "--include-untracked", "--message", SWITCH_STASH_MESSAGE], root);
    const after = await stashHead(root);
    if (after !== null && after !== before) stashed = after;
  }

  try {
    // checkout rather than switch keeps Git releases before 2.23 working.
    if (target.kind === "local") await git(["checkout", name, "--"], root);
    else await git(["checkout", "-b", name, "--track", target.remote + "/" + name], root);
  } catch (error) {
    if (stashed !== null) {
      // HEAD did not move, so the stash applies exactly where it was made.
      await restoreStash(root, stashed).catch(() => {
        throw new Error(error.message + "\\nYour uncommitted changes are saved in the Git stash.");
      });
    }
    throw error;
  }

  // Bring back changes stashed when this branch was last switched away from.
  // Restore only when it is certain to apply cleanly: the branch has not moved
  // since, and the working tree is clean.
  let restored = false;
  let keptStash = null;
  const saved = (await stashes(root)).find(
    (stash) => stash.hash !== stashed && stash.subject === "On " + name + ": " + SWITCH_STASH_MESSAGE,
  );
  if (saved) {
    const [base, head] = await Promise.all([
      git(["rev-parse", saved.hash + "^1"], root, { readOnly: true }),
      git(["rev-parse", "HEAD"], root, { readOnly: true }),
    ]);
    if (base.trim() === head.trim() && (await changedFiles(root)) === 0) {
      try {
        await restoreStash(root, saved.hash);
        restored = true;
      } catch {
        keptStash = saved.ref;
      }
    } else {
      keptStash = saved.ref;
    }
  }
  return { status: "switched", branch: name, stashed: stashed !== null, restored, keptStash };
}

emit(readInput().then((input) => switchBranch(process.cwd(), input)));
`.trim();

const LIST_TIMEOUT_MS = 30_000;
// Checkouts of large repositories can take a while; the broker waits longer.
const SWITCH_TIMEOUT_MS = 120_000;

export async function listAgentWorkspaceGitBranches(
  target: HostTarget,
  workspacePath: string,
): Promise<AgentWorkspaceGitBranches> {
  const result = await executeOnHost(
    target,
    {
      command: "node",
      args: ["-e", AGENT_WORKSPACE_GIT_BRANCHES_SCRIPT],
      cwd: workspacePath,
    },
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  const branches = JSON.parse(result.stdout) as unknown;
  if (!isAgentWorkspaceGitBranches(branches)) {
    throw new Error("The remote machine returned invalid Git branches.");
  }
  return branches;
}

export async function switchAgentWorkspaceGitBranch(
  target: HostTarget,
  workspacePath: string,
  input: {
    branch: AgentWorkspaceGitSwitchTarget;
    stash: boolean;
    /** Working directories of agents with a turn in progress on this host. */
    busyPaths: string[];
  },
): Promise<AgentWorkspaceGitSwitchResult> {
  const result = await executeOnHost(
    target,
    {
      command: "node",
      args: ["-e", AGENT_WORKSPACE_GIT_SWITCH_SCRIPT],
      cwd: workspacePath,
    },
    { timeoutMs: SWITCH_TIMEOUT_MS, stdin: JSON.stringify(input) },
  );
  const switched = JSON.parse(result.stdout) as unknown;
  if (!isAgentWorkspaceGitSwitchResult(switched)) {
    throw new Error("The remote machine returned an invalid branch switch result.");
  }
  return switched;
}
