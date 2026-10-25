import type { HostConnectorCommand } from "@overtchat/agent-bridge";

export type ConnectorCommandLane = "session" | "workspace" | "git";

export type ConnectorCommandLaneLimits = Record<ConnectorCommandLane, number>;

// Each lane owns its slots, so slow background work (repository status,
// provider discovery) can never occupy the capacity that opening or driving a
// session needs.
const DEFAULT_LANE_LIMITS: ConnectorCommandLaneLimits = {
  session: 4,
  workspace: 4,
  git: 2,
};

type ScheduledCommand = {
  command: Extract<HostConnectorCommand, { type: "request" }>;
  queuedAt: number;
  sequence: number;
};

type Lane = {
  readonly limit: number;
  readonly pending: ScheduledCommand[];
  running: number;
};

export function connectorCommandLane(
  command: Extract<HostConnectorCommand, { type: "request" }>,
): ConnectorCommandLane {
  switch (command.request.type) {
    case "create_session":
    case "open_session":
    case "session_command":
    case "subscribe_session":
    case "unsubscribe_session":
    case "session_history":
      return "session";
    case "git_status":
    case "watch_git_status":
      return "git";
    default:
      return "workspace";
  }
}

function priority(command: ScheduledCommand["command"]): number {
  switch (command.request.type) {
    case "get_catalog":
    case "list_workspace_directory":
    case "read_workspace_file":
    case "list_git_branches":
    case "switch_git_branch":
    case "create_git_worktree":
    case "inspect_git_worktree":
    case "remove_git_worktree":
      return 0;
    default:
      return 1;
  }
}

export function isConnectorCommandBarrier(
  command: HostConnectorCommand,
): boolean {
  return (
    command.type === "sync" ||
    (command.type === "request" &&
      [
        "stop_session",
        "stop_workspace",
        "stop_connection",
        "stop_all",
      ].includes(command.request.type))
  );
}

export class ConnectorCommandScheduler {
  private readonly lanes: Record<ConnectorCommandLane, Lane>;
  private sequence = 0;
  private closed = false;
  private readonly drainWaiters = new Set<() => void>();

  constructor(
    private readonly handle: (command: HostConnectorCommand) => Promise<void>,
    limits: Partial<ConnectorCommandLaneLimits> = {},
    private readonly now: () => number = Date.now,
  ) {
    const resolved = { ...DEFAULT_LANE_LIMITS, ...limits };
    for (const limit of Object.values(resolved)) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(
          "Connector command concurrency must be a positive integer.",
        );
      }
    }
    this.lanes = {
      session: { limit: resolved.session, pending: [], running: 0 },
      workspace: { limit: resolved.workspace, pending: [], running: 0 },
      git: { limit: resolved.git, pending: [], running: 0 },
    };
  }

  enqueue(command: Extract<HostConnectorCommand, { type: "request" }>): void {
    if (this.closed) return;
    const lane = this.lanes[connectorCommandLane(command)];
    lane.pending.push({
      command,
      queuedAt: this.now(),
      sequence: this.sequence++,
    });
    lane.pending.sort(
      (left, right) =>
        priority(left.command) - priority(right.command) ||
        left.sequence - right.sequence,
    );
    this.pump(lane);
  }

  async drain(): Promise<void> {
    if (this.idle()) return;
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  close(): void {
    this.closed = true;
    for (const lane of Object.values(this.lanes)) lane.pending.length = 0;
    this.finishDrainIfIdle();
  }

  private pump(lane: Lane): void {
    while (!this.closed && lane.running < lane.limit && lane.pending.length > 0) {
      const scheduled = lane.pending.shift()!;
      const queueMs = this.now() - scheduled.queuedAt;
      if (queueMs >= 100) {
        console.info(
          `[connector:timing] request_queue type=${scheduled.command.request.type} queue_ms=${queueMs}`,
        );
      }
      lane.running += 1;
      void this.handle(scheduled.command).then(
        () => this.finished(lane),
        () => this.finished(lane),
      );
    }
  }

  private idle(): boolean {
    return Object.values(this.lanes).every(
      (lane) => lane.running === 0 && lane.pending.length === 0,
    );
  }

  private finishDrainIfIdle(): void {
    if (!this.idle()) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }

  private finished(lane: Lane): void {
    lane.running -= 1;
    this.pump(lane);
    this.finishDrainIfIdle();
  }
}
