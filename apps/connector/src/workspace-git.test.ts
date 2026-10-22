import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import type {
  AgentWorkspaceGitHostWatcher,
  AgentWorkspaceGitHostWatcherHandlers,
  HostTarget,
} from "@overtchat/agent-runtime";
import {
  WorkspaceGitStatusReader,
  WorkspaceGitWatches,
  workspaceGitKey,
} from "./workspace-git";

const local: HostTarget = { transport: "local", shellMode: "login" };
const remote: HostTarget = { transport: "ssh", alias: "box", shellMode: "login" };

function status(branch: string): AgentWorkspaceGitStatus {
  return {
    isGit: true,
    repositoryRoot: "/workspace",
    branch,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("WorkspaceGitStatusReader", () => {
  it("shares one inspection between concurrent callers", async () => {
    const pending = deferred<AgentWorkspaceGitStatus>();
    const inspect = vi.fn(() => pending.promise);
    const reader = new WorkspaceGitStatusReader(inspect);

    const first = reader.read(local, "/workspace");
    const second = reader.read(local, "/workspace");
    pending.resolve(status("main"));

    await expect(first).resolves.toEqual(status("main"));
    await expect(second).resolves.toEqual(status("main"));
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("reuses a settled status briefly and then inspects again", async () => {
    let now = 1_000;
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(status("main"))
      .mockResolvedValueOnce(status("feature"));
    const reader = new WorkspaceGitStatusReader(inspect, () => now, 1_500);

    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
    now += 1_499;
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
    now += 1;
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("feature"),
    );
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("does not reuse failures", async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(new Error("Git is not installed."))
      .mockResolvedValueOnce(status("main"));
    const reader = new WorkspaceGitStatusReader(inspect);

    await expect(reader.read(local, "/workspace")).rejects.toThrow(
      "Git is not installed.",
    );
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
  });

  it("keeps workspaces on different hosts and paths separate", async () => {
    const inspect = vi.fn(async (target: HostTarget, path: string) =>
      status(`${target.transport}:${path}`),
    );
    const reader = new WorkspaceGitStatusReader(inspect);

    await Promise.all([
      reader.read(local, "/workspace"),
      reader.read(remote, "/workspace"),
      reader.read(local, "/other"),
    ]);

    expect(inspect).toHaveBeenCalledTimes(3);
    expect(workspaceGitKey(local, "/workspace")).not.toBe(
      workspaceGitKey(remote, "/workspace"),
    );
  });
});

type FakeHostWatcher = {
  target: HostTarget;
  handlers: AgentWorkspaceGitHostWatcherHandlers;
  /** Workspace ids by path that the process is currently watching. */
  watched: Map<string, string>;
  exit(): void;
  stopped: boolean;
};

function fakeWatchers() {
  const started: FakeHostWatcher[] = [];
  const start = vi.fn(
    (
      target: HostTarget,
      handlers: AgentWorkspaceGitHostWatcherHandlers,
    ): AgentWorkspaceGitHostWatcher => {
      let exit!: () => void;
      const exited = new Promise<void>((resolve) => {
        exit = resolve;
      });
      const watcher: FakeHostWatcher = {
        target,
        handlers,
        watched: new Map(),
        exit,
        stopped: false,
      };
      started.push(watcher);
      return {
        exited,
        watch(id, path) {
          watcher.watched.set(path, id);
        },
        unwatch(id) {
          for (const [path, watchedId] of watcher.watched) {
            if (watchedId === id) watcher.watched.delete(path);
          }
        },
        async stop() {
          watcher.stopped = true;
          exit();
        },
      };
    },
  );
  /** Reports a status for the workspace at `path` from the given process. */
  const report = (index: number, path: string, value: AgentWorkspaceGitStatus) => {
    const watcher = started[index]!;
    watcher.handlers.status(watcher.watched.get(path)!, value);
  };
  return { started, start, report };
}

describe("WorkspaceGitWatches", () => {
  it("shares one watcher per workspace and fans statuses out to every watch", async () => {
    const { start, report } = fakeWatchers();
    const watches = new WorkspaceGitWatches(
      new WorkspaceGitStatusReader(vi.fn()),
      start,
    );
    const first = vi.fn();
    const second = vi.fn();

    const initialFirst = watches.watch("a", local, "/workspace", first);
    const initialSecond = watches.watch("b", local, "/workspace", second);
    report(0, "/workspace", status("main"));

    await expect(initialFirst).resolves.toEqual({
      status: status("main"),
      revision: 1,
    });
    await expect(initialSecond).resolves.toEqual({
      status: status("main"),
      revision: 1,
    });
    expect(start).toHaveBeenCalledTimes(1);

    report(0, "/workspace", status("feature"));
    expect(first).toHaveBeenLastCalledWith(status("feature"), 2);
    expect(second).toHaveBeenLastCalledWith(status("feature"), 2);
    expect(watches.current(local, "/workspace")).toEqual(status("feature"));
    await watches.stop();
  });

  it("serves every workspace on a host from one process and separates hosts", async () => {
    const { started, start, report } = fakeWatchers();
    const watches = new WorkspaceGitWatches(
      new WorkspaceGitStatusReader(vi.fn()),
      start,
    );
    const alpha = vi.fn();
    const beta = vi.fn();

    const initialAlpha = watches.watch("a", local, "/alpha", alpha);
    const initialBeta = watches.watch("b", local, "/beta", beta);
    const initialRemote = watches.watch("c", remote, "/alpha", vi.fn());
    report(0, "/alpha", status("alpha"));
    report(0, "/beta", status("beta"));
    report(1, "/alpha", status("remote"));

    await expect(initialAlpha).resolves.toMatchObject({ status: status("alpha") });
    await expect(initialBeta).resolves.toMatchObject({ status: status("beta") });
    await expect(initialRemote).resolves.toMatchObject({ status: status("remote") });
    expect(start).toHaveBeenCalledTimes(2);
    expect(started[0]!.target).toEqual(local);
    expect(started[1]!.target).toEqual(remote);
    expect([...started[0]!.watched.keys()]).toEqual(["/alpha", "/beta"]);

    report(0, "/beta", status("beta-2"));
    expect(beta).toHaveBeenLastCalledWith(status("beta-2"), 2);
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(alpha).toHaveBeenLastCalledWith(status("alpha"), 1);
    await watches.stop();
  });

  it("answers from a direct inspection when the watcher cannot report", async () => {
    const { started, start } = fakeWatchers();
    const inspect = vi.fn().mockResolvedValue(status("direct"));
    const watches = new WorkspaceGitWatches(
      new WorkspaceGitStatusReader(inspect),
      start,
    );

    const initial = watches.watch("a", local, "/workspace", vi.fn());
    started[0]!.handlers.error(
      started[0]!.watched.get("/workspace")!,
      "Git is not installed on the selected machine.",
    );

    await expect(initial).resolves.toEqual({
      status: status("direct"),
      revision: 0,
    });
    expect(watches.current(local, "/workspace")).toBeNull();
    await watches.stop();
  });

  it("keeps an unwatched workspace for the idle grace, then drops it and finally the process", async () => {
    vi.useFakeTimers();
    try {
      const { started, start, report } = fakeWatchers();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { idleGraceMs: 1_000 },
      );
      const first = watches.watch("a", local, "/first", vi.fn());
      const second = watches.watch("b", local, "/second", vi.fn());
      report(0, "/first", status("first"));
      report(0, "/second", status("second"));
      await Promise.all([first, second]);

      watches.unwatchAll();
      await vi.advanceTimersByTimeAsync(500);
      const rewatch = watches.watch("c", local, "/first", vi.fn());
      await expect(rewatch).resolves.toEqual({
        status: status("first"),
        revision: 1,
      });
      await vi.advanceTimersByTimeAsync(500);
      expect([...started[0]!.watched.keys()]).toEqual(["/first"]);
      expect(started[0]!.stopped).toBe(false);

      watches.unwatch("c");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(started[0]!.stopped).toBe(true);
      expect(watches.current(local, "/first")).toBeNull();
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts a host watcher that exits and re-adds every watched workspace", async () => {
    vi.useFakeTimers();
    try {
      const { started, start, report } = fakeWatchers();
      const listener = vi.fn();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { restartBaseMs: 100 },
      );
      const first = watches.watch("a", remote, "/first", listener);
      const second = watches.watch("b", remote, "/second", vi.fn());
      report(0, "/first", status("main"));
      report(0, "/second", status("main"));
      await Promise.all([first, second]);

      started[0]!.exit();
      await vi.advanceTimersByTimeAsync(0);
      expect(watches.current(remote, "/first")).toBeNull();
      await vi.advanceTimersByTimeAsync(100);
      expect(start).toHaveBeenCalledTimes(2);
      expect([...started[1]!.watched.keys()]).toEqual(["/first", "/second"]);

      report(1, "/first", status("feature"));
      expect(listener).toHaveBeenLastCalledWith(status("feature"), 2);
      await watches.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores reports from a replaced watcher", async () => {
    vi.useFakeTimers();
    try {
      const { started, start, report } = fakeWatchers();
      const listener = vi.fn();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { restartBaseMs: 10 },
      );
      const initial = watches.watch("a", local, "/workspace", listener);
      report(0, "/workspace", status("main"));
      await initial;
      started[0]!.exit();
      await vi.advanceTimersByTimeAsync(10);

      report(0, "/workspace", status("stale"));
      expect(listener).not.toHaveBeenCalledWith(status("stale"), expect.anything());
      await watches.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
