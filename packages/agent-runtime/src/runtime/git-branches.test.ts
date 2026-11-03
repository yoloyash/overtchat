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

import type { AgentWorkspaceGitSwitchTarget } from "@overtchat/agent-bridge";
import {
  AGENT_WORKSPACE_GIT_BRANCHES_SCRIPT,
  AGENT_WORKSPACE_GIT_SWITCH_SCRIPT,
  listAgentWorkspaceGitBranches,
  switchAgentWorkspaceGitBranch,
} from "./git-branches";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function temporaryDirectory(): string {
  // Resolve symlinked temporary roots (macOS /var) to what Git reports.
  return realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-branch-")));
}

function createRepository(): string {
  const directory = temporaryDirectory();
  git(directory, "init", "--quiet", "--initial-branch=main");
  git(directory, "config", "user.email", "test@overtchat.local");
  git(directory, "config", "user.name", "OvertChat Test");
  writeFileSync(path.join(directory, "tracked.txt"), "main\n");
  git(directory, "add", ".");
  git(directory, "commit", "--quiet", "-m", "initial");
  return directory;
}

function commitOn(directory: string, branch: string, content: string): void {
  git(directory, "checkout", "--quiet", "-B", branch);
  writeFileSync(path.join(directory, "tracked.txt"), content);
  git(directory, "commit", "--quiet", "-am", `${branch} change`);
}

function listBranches(cwd: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, ["-e", AGENT_WORKSPACE_GIT_BRANCHES_SCRIPT], {
      cwd,
      encoding: "utf8",
    }),
  ) as Record<string, unknown>;
}

function switchBranch(
  cwd: string,
  branch: AgentWorkspaceGitSwitchTarget,
  { stash = false, busyPaths = [] }: { stash?: boolean; busyPaths?: string[] } = {},
): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["-e", AGENT_WORKSPACE_GIT_SWITCH_SCRIPT], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ branch, stash, busyPaths }),
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("agent workspace Git branch list", () => {
  it("lists local branches, then remote-only branches, marking other worktrees", () => {
    const upstream = createRepository();
    commitOn(upstream, "remote-only", "remote\n");
    commitOn(upstream, "shared", "shared\n");
    git(upstream, "checkout", "--quiet", "main");

    const directory = temporaryDirectory();
    git(directory, "clone", "--quiet", upstream, ".");
    git(directory, "branch", "--quiet", "shared", "origin/shared");
    git(directory, "branch", "--quiet", "elsewhere");
    const worktree = path.join(temporaryDirectory(), "elsewhere");
    git(directory, "worktree", "add", "--quiet", worktree, "elsewhere");

    const listing = listBranches(directory);
    expect(listing).toMatchObject({ isGit: true, current: "main", truncated: false });
    const branches = listing.branches as Array<Record<string, unknown>>;
    expect(
      branches.map((branch) => [branch.remote ? `${String(branch.remote)}/` : "", branch.name].join("")),
    ).toEqual(expect.arrayContaining(["main", "shared", "elsewhere", "origin/remote-only"]));
    // origin/main and origin/shared are reached through their local branches;
    // origin/HEAD is a symbolic ref.
    expect(branches).toHaveLength(4);
    expect(branches.findIndex((branch) => branch.remote !== null)).toBe(3);
    expect(branches.find((branch) => branch.name === "main")).toMatchObject({
      current: true,
      worktreePath: null,
      committedAt: expect.any(Number),
    });
    expect(
      realpathSync(String(branches.find((branch) => branch.name === "elsewhere")?.worktreePath)),
    ).toBe(realpathSync(worktree));
  });

  it("works from a subdirectory and reports detached HEAD and non-repositories", () => {
    const directory = createRepository();
    mkdirSync(path.join(directory, "packages"));
    git(directory, "checkout", "--quiet", "--detach");
    expect(listBranches(path.join(directory, "packages"))).toMatchObject({
      isGit: true,
      current: null,
      branches: [{ name: "main", current: false }],
    });
    expect(listBranches(temporaryDirectory())).toEqual({
      isGit: false,
      current: null,
      branches: [],
      truncated: false,
    });
  });
});

describe("agent workspace Git branch switch", () => {
  it("switches to local and remote branches and creates new ones", () => {
    const upstream = createRepository();
    commitOn(upstream, "from-remote", "remote\n");
    git(upstream, "checkout", "--quiet", "main");
    const directory = temporaryDirectory();
    git(directory, "clone", "--quiet", upstream, ".");
    git(directory, "branch", "--quiet", "feature");

    expect(switchBranch(directory, { kind: "local", name: "feature" })).toEqual({
      status: "switched",
      branch: "feature",
      stashed: false,
      restored: false,
      keptStash: null,
    });
    expect(git(directory, "branch", "--show-current")).toBe("feature");

    expect(
      switchBranch(directory, { kind: "remote", remote: "origin", name: "from-remote" }),
    ).toMatchObject({ status: "switched", branch: "from-remote" });
    expect(git(directory, "rev-parse", "--abbrev-ref", "from-remote@{upstream}")).toBe(
      "origin/from-remote",
    );
    expect(readFileSync(path.join(directory, "tracked.txt"), "utf8")).toBe("remote\n");

    // A new branch starts at HEAD and keeps uncommitted work in place.
    writeFileSync(path.join(directory, "draft.txt"), "draft\n");
    expect(switchBranch(directory, { kind: "new", name: "topic/next" })).toMatchObject({
      status: "switched",
      branch: "topic/next",
      stashed: false,
    });
    expect(git(directory, "branch", "--show-current")).toBe("topic/next");
    expect(existsSync(path.join(directory, "draft.txt"))).toBe(true);
  });

  it("reports uncommitted changes without touching the repository", () => {
    const directory = createRepository();
    git(directory, "branch", "--quiet", "feature");
    writeFileSync(path.join(directory, "untracked.txt"), "new\n");
    writeFileSync(path.join(directory, "tracked.txt"), "edited\n");

    expect(switchBranch(directory, { kind: "local", name: "feature" })).toEqual({
      status: "changes_present",
      changedFiles: 2,
    });
    expect(git(directory, "branch", "--show-current")).toBe("main");
    expect(git(directory, "stash", "list")).toBe("");
  });

  it("stashes changes on switch and restores them on return", () => {
    const directory = createRepository();
    git(directory, "branch", "--quiet", "feature");
    writeFileSync(path.join(directory, "tracked.txt"), "edited\n");
    writeFileSync(path.join(directory, "staged.txt"), "staged\n");
    git(directory, "add", "staged.txt");
    writeFileSync(path.join(directory, "untracked.txt"), "new\n");

    expect(
      switchBranch(directory, { kind: "local", name: "feature" }, { stash: true }),
    ).toEqual({
      status: "switched",
      branch: "feature",
      stashed: true,
      restored: false,
      keptStash: null,
    });
    expect(git(directory, "status", "--porcelain")).toBe("");
    expect(git(directory, "stash", "list")).toContain("On main: OvertChat branch switch");

    expect(switchBranch(directory, { kind: "local", name: "main" })).toEqual({
      status: "switched",
      branch: "main",
      stashed: false,
      restored: true,
      keptStash: null,
    });
    expect(git(directory, "stash", "list")).toBe("");
    expect(readFileSync(path.join(directory, "tracked.txt"), "utf8")).toBe("edited\n");
    expect(readFileSync(path.join(directory, "untracked.txt"), "utf8")).toBe("new\n");
    // The index is restored too.
    expect(git(directory, "diff", "--cached", "--name-only")).toBe("staged.txt");
  });

  it("keeps a stash whose branch has moved since it was made", () => {
    const directory = createRepository();
    git(directory, "branch", "--quiet", "feature");
    writeFileSync(path.join(directory, "tracked.txt"), "edited\n");
    switchBranch(directory, { kind: "local", name: "feature" }, { stash: true });
    git(directory, "branch", "--quiet", "--force", "main", "feature");
    commitOn(directory, "main", "moved\n");
    git(directory, "checkout", "--quiet", "feature");

    expect(switchBranch(directory, { kind: "local", name: "main" })).toEqual({
      status: "switched",
      branch: "main",
      stashed: false,
      restored: false,
      keptStash: "stash@{0}",
    });
    expect(readFileSync(path.join(directory, "tracked.txt"), "utf8")).toBe("moved\n");
    expect(git(directory, "stash", "list")).toContain("On main: OvertChat branch switch");
  });

  it("puts stashed changes back when the checkout fails", () => {
    const directory = createRepository();
    git(directory, "branch", "--quiet", "elsewhere");
    git(directory, "worktree", "add", "--quiet", path.join(temporaryDirectory(), "wt"), "elsewhere");
    writeFileSync(path.join(directory, "tracked.txt"), "edited\n");

    expect(() =>
      switchBranch(directory, { kind: "local", name: "elsewhere" }, { stash: true }),
    ).toThrow(/elsewhere/);
    expect(git(directory, "branch", "--show-current")).toBe("main");
    expect(readFileSync(path.join(directory, "tracked.txt"), "utf8")).toBe("edited\n");
    expect(git(directory, "stash", "list")).toBe("");
  });

  it("refuses while an agent is running in the same working tree", () => {
    const directory = createRepository();
    mkdirSync(path.join(directory, "app"));
    git(directory, "branch", "--quiet", "feature");
    const otherWorktree = path.join(temporaryDirectory(), "wt");
    git(directory, "worktree", "add", "--quiet", "-b", "other", otherWorktree);

    expect(
      switchBranch(directory, { kind: "local", name: "feature" }, {
        busyPaths: [path.join(directory, "app")],
      }),
    ).toEqual({ status: "agent_running" });
    expect(git(directory, "branch", "--show-current")).toBe("main");

    // Agents in other worktrees, other repositories, or missing directories do not block.
    expect(
      switchBranch(directory, { kind: "local", name: "feature" }, {
        busyPaths: [otherWorktree, temporaryDirectory(), path.join(directory, "missing")],
      }),
    ).toMatchObject({ status: "switched", branch: "feature" });
  });

  it("rejects invalid, duplicate, and vanished branches", () => {
    const directory = createRepository();
    expect(() => switchBranch(directory, { kind: "new", name: "bad..name" })).toThrow(
      /not a valid branch name/,
    );
    expect(() => switchBranch(directory, { kind: "new", name: "main" })).toThrow(
      /already exists/,
    );
    expect(() => switchBranch(directory, { kind: "local", name: "gone" })).toThrow(
      /no longer exists/,
    );
    expect(switchBranch(directory, { kind: "local", name: "main" })).toMatchObject({
      status: "switched",
      branch: "main",
    });
  });
});

describe("agent workspace Git branch host calls", () => {
  const target = { transport: "ssh" as const, alias: "devbox" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes switch input on stdin and validates both results", async () => {
    mocks.executeOnHost.mockResolvedValueOnce({
      stdout: JSON.stringify({ isGit: true, current: "main", branches: [], truncated: false }),
      stderr: "",
    });
    await expect(listAgentWorkspaceGitBranches(target, "/repo")).resolves.toMatchObject({
      current: "main",
    });
    expect(mocks.executeOnHost).toHaveBeenLastCalledWith(
      target,
      { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_BRANCHES_SCRIPT], cwd: "/repo" },
      { timeoutMs: 30_000 },
    );

    mocks.executeOnHost.mockResolvedValueOnce({
      stdout: JSON.stringify({ status: "agent_running" }),
      stderr: "",
    });
    const input = {
      branch: { kind: "local" as const, name: "feature" },
      stash: false,
      busyPaths: ["/repo/app"],
    };
    await expect(switchAgentWorkspaceGitBranch(target, "/repo", input)).resolves.toEqual({
      status: "agent_running",
    });
    expect(mocks.executeOnHost).toHaveBeenLastCalledWith(
      target,
      { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_SWITCH_SCRIPT], cwd: "/repo" },
      { timeoutMs: 120_000, stdin: JSON.stringify(input) },
    );

    mocks.executeOnHost.mockResolvedValueOnce({ stdout: '{"status":"maybe"}', stderr: "" });
    await expect(switchAgentWorkspaceGitBranch(target, "/repo", input)).rejects.toThrow(
      "invalid branch switch result",
    );
  });
});
