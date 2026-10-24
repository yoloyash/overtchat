import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeOnHost: vi.fn() }));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_WORKSPACE_GIT_WORKTREE_CREATE_SCRIPT,
  AGENT_WORKSPACE_GIT_WORKTREE_INSPECT_SCRIPT,
  AGENT_WORKSPACE_GIT_WORKTREE_REMOVE_SCRIPT,
  createAgentWorkspaceGitWorktree,
  inspectAgentWorkspaceGitWorktree,
  removeAgentWorkspaceGitWorktree,
} from "./git-worktrees";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function temporaryDirectory(): string {
  // Resolve symlinked temporary roots (macOS /var) to what Git reports.
  return realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-worktree-")));
}

function createRepository(): string {
  const directory = temporaryDirectory();
  git(directory, "init", "--quiet", "--initial-branch=main");
  git(directory, "config", "user.email", "test@overtchat.local");
  git(directory, "config", "user.name", "OvertChat Test");
  mkdirSync(path.join(directory, "app"));
  writeFileSync(path.join(directory, "app", "tracked.txt"), "main\n");
  git(directory, "add", ".");
  git(directory, "commit", "--quiet", "-m", "initial");
  return directory;
}

function run(
  script: string,
  input: unknown,
  { cwd, home }: { cwd?: string; home: string },
): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: cwd ?? home,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("agent workspace Git worktrees", () => {
  let home: string;

  beforeEach(() => {
    home = temporaryDirectory();
  });

  function create(cwd: string, base: unknown, branch: string) {
    return run(AGENT_WORKSPACE_GIT_WORKTREE_CREATE_SCRIPT, { base, branch }, { cwd, home });
  }
  const inspect = (workspace: string) =>
    run(AGENT_WORKSPACE_GIT_WORKTREE_INSPECT_SCRIPT, { path: workspace }, { home });
  const remove = (workspace: string) =>
    run(AGENT_WORKSPACE_GIT_WORKTREE_REMOVE_SCRIPT, { path: workspace }, { home });

  it("creates a branch in a worktree under the managed directory", () => {
    const repository = createRepository();
    git(repository, "checkout", "--quiet", "-b", "feature");
    writeFileSync(path.join(repository, "app", "tracked.txt"), "feature\n");
    git(repository, "commit", "--quiet", "-am", "feature");
    writeFileSync(path.join(repository, "uncommitted.txt"), "stays\n");

    const created = create(repository, { kind: "local", name: "main" }, "topic/one");

    const worktreePath = created.worktreePath as string;
    expect(path.dirname(path.dirname(worktreePath))).toBe(
      path.join(home, ".overtchat", "worktrees"),
    );
    expect(path.basename(path.dirname(worktreePath))).toMatch(
      new RegExp(`^${path.basename(repository)}-[0-9a-f]{8}$`),
    );
    expect(created).toEqual({
      path: worktreePath,
      worktreePath,
      name: "topic-one",
      branch: "topic/one",
    });
    expect(git(worktreePath, "branch", "--show-current")).toBe("topic/one");
    expect(readFileSync(path.join(worktreePath, "app", "tracked.txt"), "utf8")).toBe("main\n");
    expect(existsSync(path.join(worktreePath, "uncommitted.txt"))).toBe(false);
    // The source checkout is untouched.
    expect(git(repository, "branch", "--show-current")).toBe("feature");
    expect(existsSync(path.join(repository, "uncommitted.txt"))).toBe(true);
  });

  it("keeps the source workspace's subdirectory and avoids directory collisions", () => {
    const repository = createRepository();
    const first = create(path.join(repository, "app"), { kind: "local", name: "main" }, "topic");
    expect(first.path).toBe(path.join(first.worktreePath as string, "app"));

    // A leftover directory with the same name gets a numbered sibling.
    git(repository, "worktree", "remove", "--force", first.worktreePath as string);
    git(repository, "branch", "--quiet", "-D", "topic");
    mkdirSync(first.worktreePath as string);
    const second = create(repository, { kind: "local", name: "main" }, "topic");
    expect(second.worktreePath).toBe(`${first.worktreePath as string}-2`);
    expect(second.name).toBe("topic-2");
  });

  it("starts from a remote branch's latest commit without tracking it", () => {
    const upstream = createRepository();
    const clone = temporaryDirectory();
    git(clone, "clone", "--quiet", upstream, ".");
    writeFileSync(path.join(upstream, "app", "tracked.txt"), "newer\n");
    git(upstream, "commit", "--quiet", "-am", "newer");

    const created = create(clone, { kind: "remote", remote: "origin", name: "main" }, "topic");

    const worktreePath = created.worktreePath as string;
    expect(git(worktreePath, "rev-parse", "HEAD")).toBe(git(upstream, "rev-parse", "HEAD"));
    expect(
      spawnSync("git", ["rev-parse", "--abbrev-ref", "topic@{upstream}"], { cwd: worktreePath })
        .status,
    ).not.toBe(0);
  });

  it("rejects invalid and existing branch names and missing bases", () => {
    const repository = createRepository();
    const main = { kind: "local", name: "main" };
    expect(() => create(repository, main, "bad..name")).toThrow("not a valid branch name");
    expect(() => create(repository, main, "main")).toThrow("A branch named main already exists");
    expect(() => create(repository, { kind: "local", name: "gone" }, "topic")).toThrow(
      "The branch gone no longer exists",
    );
    expect(() => create(temporaryDirectory(), main, "topic")).toThrow("not a Git repository");
  });

  it("inspects uncommitted changes and removes the worktree but keeps its branch", () => {
    const repository = createRepository();
    const created = create(path.join(repository, "app"), { kind: "local", name: "main" }, "topic");
    const workspace = created.path as string;
    writeFileSync(path.join(workspace, "tracked.txt"), "changed\n");
    writeFileSync(path.join(workspace, "new.txt"), "new\n");

    expect(inspect(workspace)).toEqual({
      exists: true,
      worktreePath: created.worktreePath,
      branch: "topic",
      changedFiles: 2,
    });
    expect(remove(workspace)).toEqual({ removed: true });
    expect(existsSync(created.worktreePath as string)).toBe(false);
    expect(existsSync(path.dirname(created.worktreePath as string))).toBe(false);
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      created.worktreePath as string,
    );
    expect(git(repository, "branch", "--list", "topic")).toContain("topic");

    // Already gone is not an error.
    expect(inspect(workspace)).toEqual({
      exists: false,
      worktreePath: null,
      branch: null,
      changedFiles: 0,
    });
    expect(remove(workspace)).toEqual({ removed: true });
  });

  it("never removes a main checkout or a worktree it did not create", () => {
    const repository = createRepository();
    const external = path.join(temporaryDirectory(), "external");
    git(repository, "worktree", "add", "--quiet", "-b", "external", external);

    expect(() => remove(repository)).toThrow("not a Git worktree");
    expect(() => remove(external)).toThrow("OvertChat only deletes worktrees it created");
    expect(existsSync(path.join(repository, "app", "tracked.txt"))).toBe(true);
    expect(existsSync(external)).toBe(true);
  });
});

describe("agent workspace Git worktree host calls", () => {
  const target = { transport: "ssh" as const, alias: "devbox" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs from the source workspace to create and from the home directory to remove", async () => {
    const worktree = {
      path: "/home/me/.overtchat/worktrees/repo-1/topic",
      worktreePath: "/home/me/.overtchat/worktrees/repo-1/topic",
      name: "topic",
      branch: "topic",
    };
    mocks.executeOnHost.mockResolvedValueOnce({ stdout: JSON.stringify(worktree), stderr: "" });
    const input = { base: { kind: "local" as const, name: "main" }, branch: "topic" };
    await expect(createAgentWorkspaceGitWorktree(target, "/repo", input)).resolves.toEqual(
      worktree,
    );
    expect(mocks.executeOnHost).toHaveBeenLastCalledWith(
      target,
      { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_WORKTREE_CREATE_SCRIPT], cwd: "/repo" },
      { timeoutMs: 120_000, stdin: JSON.stringify(input) },
    );

    const inspection = { exists: true, worktreePath: worktree.path, branch: "topic", changedFiles: 0 };
    mocks.executeOnHost.mockResolvedValueOnce({ stdout: JSON.stringify(inspection), stderr: "" });
    await expect(inspectAgentWorkspaceGitWorktree(target, worktree.path)).resolves.toEqual(
      inspection,
    );
    expect(mocks.executeOnHost).toHaveBeenLastCalledWith(
      target,
      { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_WORKTREE_INSPECT_SCRIPT] },
      { timeoutMs: 30_000, stdin: JSON.stringify({ path: worktree.path }) },
    );

    mocks.executeOnHost.mockResolvedValueOnce({ stdout: '{"removed":true}', stderr: "" });
    await expect(removeAgentWorkspaceGitWorktree(target, worktree.path)).resolves.toEqual({
      removed: true,
    });
    expect(mocks.executeOnHost).toHaveBeenLastCalledWith(
      target,
      { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_WORKTREE_REMOVE_SCRIPT] },
      { timeoutMs: 120_000, stdin: JSON.stringify({ path: worktree.path }) },
    );

    mocks.executeOnHost.mockResolvedValueOnce({ stdout: '{"path":"/x"}', stderr: "" });
    await expect(createAgentWorkspaceGitWorktree(target, "/repo", input)).rejects.toThrow(
      "invalid worktree",
    );
  });
});
