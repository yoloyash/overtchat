import type {
  AgentSessionStats,
  AgentUsageUpdate,
} from "@overtchat/agent-bridge";

/** Only one read at a time; lifecycle changes invalidate outstanding reads. */
export class AgentUsagePoller {
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private active = false;
  private reading = false;
  private refreshPending = false;

  constructor(
    private readonly read: () => Promise<AgentSessionStats>,
    private readonly publish: (usage: AgentUsageUpdate) => void,
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule();
  }

  stop(): void {
    this.active = false;
    this.refreshPending = false;
    this.generation += 1;
    clearTimeout(this.timer);
  }

  /** Read again after compaction, discarding any pre-compaction request. */
  refresh(): void {
    this.generation += 1;
    this.refreshPending = true;
    clearTimeout(this.timer);
    void this.poll();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.active) return;
    this.timer = setTimeout(() => void this.poll(), 3_000);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    this.refreshPending = false;
    const generation = this.generation;
    try {
      const stats = await this.read();
      if (generation === this.generation) {
        this.publish({
          tokens: stats.tokens,
          cost: stats.cost,
          contextUsage: stats.contextUsage ?? null,
        });
      }
    } catch {
      // A transient stats failure must not erase the last successful reading.
    } finally {
      this.reading = false;
      if (this.refreshPending) void this.poll();
      else this.schedule();
    }
  }
}
