import type { HostConnectorCommand } from "@overtchat/agent-bridge";

const DEFAULT_CONCURRENCY = 4;

type ScheduledCommand = {
  command: Extract<HostConnectorCommand, { type: "request" }>;
  queuedAt: number;
  sequence: number;
};

function priority(command: ScheduledCommand["command"]): number {
  switch (command.request.type) {
    case "create_session":
    case "open_session":
    case "session_command":
    case "subscribe_session":
    case "unsubscribe_session":
      return 0;
    case "get_catalog":
    case "list_workspace_directory":
    case "read_workspace_file":
      return 1;
    default:
      return 2;
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
  private readonly pending: ScheduledCommand[] = [];
  private running = 0;
  private sequence = 0;
  private closed = false;
  private readonly drainWaiters = new Set<() => void>();

  constructor(
    private readonly handle: (command: HostConnectorCommand) => Promise<void>,
    private readonly concurrency = DEFAULT_CONCURRENCY,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(
        "Connector command concurrency must be a positive integer.",
      );
    }
  }

  enqueue(command: Extract<HostConnectorCommand, { type: "request" }>): void {
    if (this.closed) return;
    this.pending.push({
      command,
      queuedAt: this.now(),
      sequence: this.sequence++,
    });
    this.pending.sort(
      (left, right) =>
        priority(left.command) - priority(right.command) ||
        left.sequence - right.sequence,
    );
    this.pump();
  }

  async drain(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  close(): void {
    this.closed = true;
    this.pending.length = 0;
    this.finishDrainIfIdle();
  }

  private pump(): void {
    while (
      !this.closed &&
      this.running < this.concurrency &&
      this.pending.length > 0
    ) {
      const scheduled = this.pending.shift()!;
      const queueMs = this.now() - scheduled.queuedAt;
      if (queueMs >= 100) {
        console.info(
          `[connector:timing] request_queue type=${scheduled.command.request.type} queue_ms=${queueMs}`,
        );
      }
      this.running += 1;
      void this.handle(scheduled.command).then(
        () => this.finished(),
        () => this.finished(),
      );
    }
  }

  private finishDrainIfIdle(): void {
    if (this.running !== 0 || this.pending.length !== 0) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }

  private finished(): void {
    this.running -= 1;
    this.pump();
    this.finishDrainIfIdle();
  }
}
