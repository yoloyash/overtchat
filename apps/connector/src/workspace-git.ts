import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import {
  inspectAgentWorkspaceGitStatus,
  startAgentWorkspaceGitHostWatcher,
  type AgentWorkspaceGitHostWatcher,
  type AgentWorkspaceGitHostWatcherHandlers,
  type HostTarget,
} from "@overtchat/agent-runtime";

// Every open client polls each visible workspace independently. One inspection
// per workspace is shared by all callers that arrive while it runs or shortly
// after it finishes.
const STATUS_REUSE_MS = 1_500;

type CachedStatus = {
  status: AgentWorkspaceGitStatus;
  settledAt: number;
};

export function workspaceGitKey(target: HostTarget, path: string): string {
  return JSON.stringify([
    target.transport,
    target.transport === "ssh" ? target.alias : null,
    target.shellMode ?? null,
    path,
  ]);
}

export class WorkspaceGitStatusReader {
  private readonly inflight = new Map<string, Promise<AgentWorkspaceGitStatus>>();
  private readonly settled = new Map<string, CachedStatus>();

  constructor(
    private readonly inspect: (
      target: HostTarget,
      path: string,
    ) => Promise<AgentWorkspaceGitStatus> = inspectAgentWorkspaceGitStatus,
    private readonly now: () => number = Date.now,
    private readonly reuseMs = STATUS_REUSE_MS,
  ) {}

  read(target: HostTarget, path: string): Promise<AgentWorkspaceGitStatus> {
    const key = workspaceGitKey(target, path);
    const cached = this.settled.get(key);
    if (cached && this.now() - cached.settledAt < this.reuseMs) {
      return Promise.resolve(cached.status);
    }
    this.settled.delete(key);
    const running = this.inflight.get(key);
    if (running) return running;
    const inspection = this.inspect(target, path).then(
      (status) => {
        this.inflight.delete(key);
        this.settled.set(key, { status, settledAt: this.now() });
        return status;
      },
      (error: unknown) => {
        this.inflight.delete(key);
        throw error;
      },
    );
    this.inflight.set(key, inspection);
    return inspection;
  }
}

type StartHostWatcher = (
  target: HostTarget,
  handlers: AgentWorkspaceGitHostWatcherHandlers,
) => AgentWorkspaceGitHostWatcher;

type WatchListener = (status: AgentWorkspaceGitStatus, revision: number) => void;

export type WatchedGitStatus = {
  status: AgentWorkspaceGitStatus;
  /** Increases with every pushed status; 0 means a direct inspection. */
  revision: number;
};

type WatchedHost = {
  key: string;
  target: HostTarget;
  /** Workspaces by their id inside the host process. */
  workspaces: Map<string, WatchedWorkspace>;
  process: AgentWorkspaceGitHostWatcher | null;
  restartAttempt: number;
  restartTimer?: NodeJS.Timeout;
  closed: boolean;
};

type WatchedWorkspace = {
  key: string;
  id: string;
  host: WatchedHost;
  target: HostTarget;
  path: string;
  listeners: Map<string, WatchListener>;
  status: AgentWorkspaceGitStatus | null;
  revision: number;
  firstStatus: Array<(status: AgentWorkspaceGitStatus | null) => void>;
  idleTimer?: NodeJS.Timeout;
  closed: boolean;
};

export type WorkspaceGitWatchOptions = {
  /** Keeps an unwatched workspace briefly for reconnects and navigation. */
  idleGraceMs?: number;
  firstStatusTimeoutMs?: number;
  restartBaseMs?: number;
  restartMaxMs?: number;
};

function hostKey(target: HostTarget): string {
  return JSON.stringify([
    target.transport,
    target.transport === "ssh" ? target.alias : null,
    target.shellMode ?? null,
  ]);
}

/**
 * One host-side watcher process per host, shared by every watched workspace
 * on it. The process pushes a workspace's status only when it changes; between
 * pushes the latest status also answers plain `git_status` reads without
 * spawning anything.
 */
export class WorkspaceGitWatches {
  private readonly hosts = new Map<string, WatchedHost>();
  private readonly workspaces = new Map<string, WatchedWorkspace>();
  private readonly watches = new Map<string, WatchedWorkspace>();
  private readonly idleGraceMs: number;
  private readonly firstStatusTimeoutMs: number;
  private readonly restartBaseMs: number;
  private readonly restartMaxMs: number;
  private nextWorkspaceId = 0;
  private stopped = false;

  constructor(
    private readonly reader: WorkspaceGitStatusReader,
    private readonly startHostWatcher: StartHostWatcher = startAgentWorkspaceGitHostWatcher,
    options: WorkspaceGitWatchOptions = {},
  ) {
    this.idleGraceMs = options.idleGraceMs ?? 30_000;
    this.firstStatusTimeoutMs = options.firstStatusTimeoutMs ?? 30_000;
    this.restartBaseMs = options.restartBaseMs ?? 1_000;
    this.restartMaxMs = options.restartMaxMs ?? 60_000;
  }

  current(target: HostTarget, path: string): AgentWorkspaceGitStatus | null {
    const workspace = this.workspaces.get(workspaceGitKey(target, path));
    return workspace?.host.process ? workspace.status : null;
  }

  async watch(
    watchId: string,
    target: HostTarget,
    path: string,
    listener: WatchListener,
  ): Promise<WatchedGitStatus> {
    if (this.stopped) throw new Error("The Host Connector is shutting down.");
    this.unwatch(watchId);
    const key = workspaceGitKey(target, path);
    let workspace = this.workspaces.get(key);
    if (!workspace) {
      const host = this.host(target);
      workspace = {
        key,
        id: `w${++this.nextWorkspaceId}`,
        host,
        target,
        path,
        listeners: new Map(),
        status: null,
        revision: 0,
        firstStatus: [],
        closed: false,
      };
      this.workspaces.set(key, workspace);
      host.workspaces.set(workspace.id, workspace);
      host.process?.watch(workspace.id, path);
    }
    if (workspace.idleTimer) clearTimeout(workspace.idleTimer);
    workspace.idleTimer = undefined;
    workspace.listeners.set(watchId, listener);
    this.watches.set(watchId, workspace);
    const status = workspace.host.process
      ? (workspace.status ?? (await this.firstStatus(workspace)))
      : null;
    if (status && workspace.status === status) {
      return { status, revision: workspace.revision };
    }
    // A watcher that has not reported (still starting, crashed, or failing)
    // must not block the caller: answer with a direct inspection instead.
    return { status: await this.reader.read(target, path), revision: 0 };
  }

  unwatch(watchId: string): void {
    const workspace = this.watches.get(watchId);
    if (!workspace) return;
    this.watches.delete(watchId);
    workspace.listeners.delete(watchId);
    if (workspace.listeners.size > 0 || workspace.idleTimer) return;
    workspace.idleTimer = setTimeout(() => {
      workspace.idleTimer = undefined;
      if (workspace.listeners.size === 0) this.closeWorkspace(workspace);
    }, this.idleGraceMs);
    workspace.idleTimer.unref();
  }

  /** Drops every watch; workspaces stay for the idle grace so re-watches reuse them. */
  unwatchAll(): void {
    for (const watchId of [...this.watches.keys()]) this.unwatch(watchId);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.watches.clear();
    for (const workspace of [...this.workspaces.values()]) {
      if (workspace.idleTimer) clearTimeout(workspace.idleTimer);
      workspace.closed = true;
      this.settleFirstStatus(workspace, null);
    }
    this.workspaces.clear();
    await Promise.all([...this.hosts.values()].map((host) => this.closeHost(host)));
  }

  private host(target: HostTarget): WatchedHost {
    const key = hostKey(target);
    let host = this.hosts.get(key);
    if (!host) {
      host = {
        key,
        target,
        workspaces: new Map(),
        process: null,
        restartAttempt: 0,
        closed: false,
      };
      this.hosts.set(key, host);
      this.start(host);
    }
    return host;
  }

  private firstStatus(
    workspace: WatchedWorkspace,
  ): Promise<AgentWorkspaceGitStatus | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(null), this.firstStatusTimeoutMs);
      timer.unref();
      const settle = (status: AgentWorkspaceGitStatus | null) => {
        clearTimeout(timer);
        workspace.firstStatus = workspace.firstStatus.filter((entry) => entry !== settle);
        resolve(status);
      };
      workspace.firstStatus.push(settle);
    });
  }

  private settleFirstStatus(
    workspace: WatchedWorkspace,
    status: AgentWorkspaceGitStatus | null,
  ): void {
    for (const settle of [...workspace.firstStatus]) settle(status);
  }

  private start(host: WatchedHost): void {
    if (host.closed || this.stopped) return;
    let watcher: AgentWorkspaceGitHostWatcher;
    try {
      watcher = this.startHostWatcher(host.target, {
        status: (id, status) => {
          const workspace = host.workspaces.get(id);
          if (host.process !== watcher || !workspace) return;
          host.restartAttempt = 0;
          workspace.status = status;
          workspace.revision += 1;
          this.settleFirstStatus(workspace, status);
          for (const listener of workspace.listeners.values()) {
            listener(status, workspace.revision);
          }
        },
        error: (id) => {
          const workspace = host.workspaces.get(id);
          if (host.process !== watcher || !workspace) return;
          // Plain reads fall through to a direct inspection, which reports
          // the failure to the caller exactly as before watching existed.
          workspace.status = null;
          this.settleFirstStatus(workspace, null);
        },
      });
    } catch {
      this.scheduleRestart(host);
      return;
    }
    host.process = watcher;
    for (const workspace of host.workspaces.values()) {
      watcher.watch(workspace.id, workspace.path);
    }
    void watcher.exited.then(() => {
      if (host.process !== watcher) return;
      host.process = null;
      for (const workspace of host.workspaces.values()) {
        workspace.status = null;
        this.settleFirstStatus(workspace, null);
      }
      this.scheduleRestart(host);
    });
  }

  private scheduleRestart(host: WatchedHost): void {
    if (host.closed || this.stopped || host.workspaces.size === 0) {
      void this.closeHost(host);
      return;
    }
    const delay = Math.min(
      this.restartBaseMs * 2 ** host.restartAttempt,
      this.restartMaxMs,
    );
    host.restartAttempt += 1;
    host.restartTimer = setTimeout(() => {
      host.restartTimer = undefined;
      this.start(host);
    }, delay);
    host.restartTimer.unref();
  }

  private closeWorkspace(workspace: WatchedWorkspace): void {
    if (workspace.closed) return;
    workspace.closed = true;
    if (this.workspaces.get(workspace.key) === workspace) {
      this.workspaces.delete(workspace.key);
    }
    if (workspace.idleTimer) clearTimeout(workspace.idleTimer);
    for (const watchId of workspace.listeners.keys()) this.watches.delete(watchId);
    workspace.listeners.clear();
    this.settleFirstStatus(workspace, null);
    const host = workspace.host;
    host.workspaces.delete(workspace.id);
    if (host.workspaces.size === 0) void this.closeHost(host);
    else host.process?.unwatch(workspace.id);
  }

  private async closeHost(host: WatchedHost): Promise<void> {
    if (host.closed) return;
    host.closed = true;
    if (this.hosts.get(host.key) === host) this.hosts.delete(host.key);
    if (host.restartTimer) clearTimeout(host.restartTimer);
    const watcher = host.process;
    host.process = null;
    await watcher?.stop().catch(() => {});
  }
}
