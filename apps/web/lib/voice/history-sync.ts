import type { VoiceHistoryItem } from "@overtchat/shared";

export class VoiceHistorySaveError extends Error {
  constructor(public readonly retryable: boolean) {
    super("Voice history could not be saved.");
  }
}

/** An acknowledged outbox. Failed batches stay pending, including after End. */
export class VoiceHistorySync {
  private pending = new Map<string, VoiceHistoryItem>();
  private acknowledged = new Map<string, string>();
  private running = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  constructor(
    private readonly save: (items: VoiceHistoryItem[]) => Promise<void>,
    private readonly onWarning: (message: string | null) => void,
  ) {}

  enqueue(items: VoiceHistoryItem[]): void {
    for (const item of items) {
      if (this.pending.has(item.id) || this.acknowledged.get(item.id) !== JSON.stringify(item)) {
        this.pending.set(item.id, item);
      }
    }
    if (!this.retryTimer) void this.flush();
  }

  retry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.running || !this.pending.size) return;
    this.running = true;
    try {
      while (this.pending.size) {
        const batch = [...this.pending.values()].slice(0, 256);
        await this.save(batch);
        for (const item of batch) {
          const fingerprint = JSON.stringify(item);
          this.acknowledged.set(item.id, fingerprint);
          if (JSON.stringify(this.pending.get(item.id)) === fingerprint) {
            this.pending.delete(item.id);
          }
        }
        this.failures = 0;
      }
      this.onWarning(null);
    } catch (error) {
      const retryable = !(error instanceof VoiceHistorySaveError) || error.retryable;
      this.onWarning(retryable
        ? "Voice history could not be saved. Retrying automatically…"
        : "Voice history could not be saved. Check your connection and retry saving.");
      if (retryable) {
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.failures++, 5));
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.flush();
        }, delay);
      }
    } finally {
      this.running = false;
    }
  }
}
