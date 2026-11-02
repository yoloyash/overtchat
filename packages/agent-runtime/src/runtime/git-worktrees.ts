import {
  isAgentWorkspaceGitWorktree,
  isAgentWorkspaceGitWorktreeInspection,
  type AgentWorkspaceGitBaseRef,
  type AgentWorkspaceGitWorktree,
  type AgentWorkspaceGitWorktreeInspection,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";
import { AGENT_WORKSPACE_GIT_COMMON } from "./git-branches";

// Worktrees OvertChat creates live under ~/.overtchat/worktrees on the
// workspace's host, one directory per repository. Removal only ever deletes
// a linked worktree inside that directory.
const AGENT_WORKSPACE_WORKTREE_COMMON = `
${AGENT_WORKSPACE_GIT_COMMON}
const os = require("node:os");

function managedRoot() {
  const root = path.join(os.homedir(), ".overtchat", "worktrees");
  return fs.existsSync(root) ? fs.realpathSync(root) : root;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Resolves the linked worktree containing \`target\`, or null when it is gone.
async function linkedWorktree(target) {
  if (!fs.existsSync(target)) return null;
  const root = await repositoryRoot(target);
  if (root === null) throw new Error("The workspace is not a Git repository.");
  const [gitDir, commonDir] = (await git(
    ["rev-parse", "--git-dir", "--git-common-dir"],
    root,
    { readOnly: true },
  )).trim().split(/\\r?\\n/).map((value) => path.resolve(root, value));
  if (samePath(gitDir, commonDir)) throw new Error("The workspace is not a Git worktree.");
  return { root, commonDir };
}
`;

const FETCH_TIMEOUT_MS = 15_000;

// Input: {"base": AgentWorkspaceGitBaseRef, "branch": string}; runs in the source workspace.
export const AGENT_WORKSPACE_GIT_WORKTREE_CREATE_SCRIPT = `
${AGENT_WORKSPACE_WORKTREE_COMMON}
const crypto = require("node:crypto");

function slug(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "worktree";
}

async function createWorktree(cwd, input) {
  const root = await repositoryRoot(cwd);
  if (root === null) throw new Error("The workspace is not a Git repository.");
  const branch = input.branch;
  await git(["check-ref-format", "--branch", branch], root, { readOnly: true }).catch(() => {
    throw new Error(branch + " is not a valid branch name.");
  });
  if (await refExists(root, "refs/heads/" + branch)) {
    throw new Error("A branch named " + branch + " already exists.");
  }

  const base = input.base;
  const label = base.kind === "local" ? base.name : base.remote + "/" + base.name;
  const baseRef = base.kind === "local"
    ? "refs/heads/" + base.name
    : "refs/remotes/" + base.remote + "/" + base.name;
  if (base.kind === "remote") {
    // Start from the remote's latest commit when it is reachable, otherwise
    // from the last fetched one.
    await git(
      ["fetch", "--quiet", "--no-tags", base.remote, "+refs/heads/" + base.name + ":" + baseRef],
      root,
      { timeoutMs: ${FETCH_TIMEOUT_MS} },
    ).catch(() => {});
  }
  if (!(await refExists(root, baseRef))) throw new Error("The branch " + label + " no longer exists.");

  // Every worktree of a repository shares its common Git directory.
  const commonDir = fs.realpathSync(path.resolve(
    root,
    (await git(["rev-parse", "--git-common-dir"], root, { readOnly: true })).trim(),
  ));
  const mainRoot = path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
  const hash = crypto.createHash("sha256").update(commonDir).digest("hex").slice(0, 8);
  const parent = path.join(managedRoot(), slug(path.basename(mainRoot)) + "-" + hash);
  fs.mkdirSync(parent, { recursive: true });
  let worktreePath = path.join(parent, slug(branch));
  for (let suffix = 2; fs.existsSync(worktreePath); suffix += 1) {
    worktreePath = path.join(parent, slug(branch) + "-" + suffix);
  }
  // --no-track keeps a remote base from becoming the new branch's upstream.
  await git(["worktree", "add", "--no-track", "-b", branch, worktreePath, baseRef], root);

  // Open the same directory of the repository the source workspace had open.
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(cwd));
  const workspacePath = path.join(worktreePath, relative);
  fs.mkdirSync(workspacePath, { recursive: true });
  return {
    path: fs.realpathSync(workspacePath),
    worktreePath: fs.realpathSync(worktreePath),
    name: path.basename(worktreePath),
    branch,
  };
}

emit(readInput().then((input) => createWorktree(process.cwd(), input)));
`.trim();

// Input: {"path": string}
export const AGENT_WORKSPACE_GIT_WORKTREE_INSPECT_SCRIPT = `
${AGENT_WORKSPACE_WORKTREE_COMMON}
async function inspectWorktree(input) {
  const worktree = await linkedWorktree(input.path);
  if (worktree === null) {
    return { exists: false, worktreePath: null, branch: null, changedFiles: 0 };
  }
  return {
    exists: true,
    worktreePath: worktree.root,
    branch: await currentBranch(worktree.root),
    changedFiles: await changedFiles(worktree.root),
  };
}

emit(readInput().then(inspectWorktree));
`.trim();

// Input: {"path": string}
export const AGENT_WORKSPACE_GIT_WORKTREE_REMOVE_SCRIPT = `
${AGENT_WORKSPACE_WORKTREE_COMMON}
async function removeWorktree(input) {
  const worktree = await linkedWorktree(input.path);
  if (worktree === null) return { removed: true };
  if (!isInside(worktree.root, managedRoot())) {
    throw new Error("OvertChat only deletes worktrees it created.");
  }
  const mainRoot = path.basename(worktree.commonDir) === ".git"
    ? path.dirname(worktree.commonDir)
    : worktree.commonDir;
  try {
    await git(["worktree", "remove", "--force", worktree.root], mainRoot);
  } catch {
    // Git refuses worktrees with submodules or locks; the directory is ours to delete.
    fs.rmSync(worktree.root, { recursive: true, force: true });
  }
  await git(["worktree", "prune"], mainRoot).catch(() => {});
  // Drop the repository's directory once its last worktree is gone.
  try {
    fs.rmdirSync(path.dirname(worktree.root));
  } catch {}
  return { removed: true };
}

emit(readInput().then(removeWorktree));
`.trim();

const INSPECT_TIMEOUT_MS = 30_000;
// Checkouts of large repositories can take a while; the broker waits longer.
const CREATE_TIMEOUT_MS = 120_000;
const REMOVE_TIMEOUT_MS = 120_000;

async function runWorktreeScript(
  target: HostTarget,
  script: string,
  input: unknown,
  options: { cwd?: string; timeoutMs: number },
): Promise<unknown> {
  const result = await executeOnHost(
    target,
    {
      command: "node",
      args: ["-e", script],
      ...(options.cwd ? { cwd: options.cwd } : {}),
    },
    { timeoutMs: options.timeoutMs, stdin: JSON.stringify(input) },
  );
  return JSON.parse(result.stdout) as unknown;
}

export async function createAgentWorkspaceGitWorktree(
  target: HostTarget,
  workspacePath: string,
  input: { base: AgentWorkspaceGitBaseRef; branch: string },
): Promise<AgentWorkspaceGitWorktree> {
  const created = await runWorktreeScript(
    target,
    AGENT_WORKSPACE_GIT_WORKTREE_CREATE_SCRIPT,
    input,
    { cwd: workspacePath, timeoutMs: CREATE_TIMEOUT_MS },
  );
  if (!isAgentWorkspaceGitWorktree(created)) {
    throw new Error("The remote machine returned an invalid worktree.");
  }
  return created;
}

// The worktree being inspected or removed is not used as the working
// directory, so Windows can delete it.
export async function inspectAgentWorkspaceGitWorktree(
  target: HostTarget,
  workspacePath: string,
): Promise<AgentWorkspaceGitWorktreeInspection> {
  const inspection = await runWorktreeScript(
    target,
    AGENT_WORKSPACE_GIT_WORKTREE_INSPECT_SCRIPT,
    { path: workspacePath },
    { timeoutMs: INSPECT_TIMEOUT_MS },
  );
  if (!isAgentWorkspaceGitWorktreeInspection(inspection)) {
    throw new Error("The remote machine returned an invalid worktree inspection.");
  }
  return inspection;
}

export async function removeAgentWorkspaceGitWorktree(
  target: HostTarget,
  workspacePath: string,
): Promise<{ removed: true }> {
  const removed = await runWorktreeScript(
    target,
    AGENT_WORKSPACE_GIT_WORKTREE_REMOVE_SCRIPT,
    { path: workspacePath },
    { timeoutMs: REMOVE_TIMEOUT_MS },
  );
  if (
    typeof removed !== "object" ||
    removed === null ||
    (removed as { removed?: unknown }).removed !== true
  ) {
    throw new Error("The remote machine returned an invalid worktree removal result.");
  }
  return { removed: true };
}
