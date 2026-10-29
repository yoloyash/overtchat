import type { AgentSessionDirectoryEntry } from "@overtchat/agent-bridge";
import type { AgentAttentionEvent } from "./agentNotification";

type State = {
  entry: AgentSessionDirectoryEntry;
  /** The owner stopped the session; its end of turn is their own doing. */
  suppressed: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Turns live status updates into one event per request or finished turn.
 * Directory snapshots only set a baseline, so reconnects never alert twice.
 * A finished turn waits out a settling period that any new work cancels.
 */
export class AgentAttentionNotifications {
  private states = new Map<string, State>();

  constructor(
    private readonly notify: (event: AgentAttentionEvent) => void,
    private readonly settleMs = 5_000,
  ) {}

  reset(id: string, entry?: AgentSessionDirectoryEntry) {
    const previous = this.states.get(id);
    if (previous) this.cancel(previous);
    this.states.delete(id);
    if (entry) this.states.set(id, { entry, suppressed: false });
  }

  suppress(id: string) {
    const state = this.states.get(id);
    if (!state) return;
    state.suppressed = true;
    this.cancel(state);
  }

  /** The Stop was refused, so the turn's end is news after all. */
  resume(id: string) {
    const state = this.states.get(id);
    if (state) state.suppressed = false;
  }

  update(id: string, entry: AgentSessionDirectoryEntry) {
    const previous = this.states.get(id);
    if (!previous) {
      this.reset(id, entry);
      return;
    }
    const before = previous.entry;
    const state: State = {
      entry,
      suppressed: previous.suppressed,
      timer: previous.timer,
    };
    this.states.set(id, state);
    // New work cancels a pending "finished" and rearms after a Stop.
    if (entry.runtimeStatus === "running" && before.runtimeStatus !== "running") {
      this.cancel(state);
      state.suppressed = false;
    }
    const attention = entry.attention;
    if (attention && attention.id !== before.attention?.id) {
      this.cancel(state);
      // Request ids repeat across sessions and runtimes (Codex counts from 0
      // in each process), so the time of asking tells repeats apart.
      this.notify({
        sessionId: id,
        reason: attention.kind,
        eventId: `${id}:${attention.id}:${attention.requestedAt}`,
        attention,
      });
      return;
    }
    const turn = entry.lastTurn;
    if (turn) {
      if (turn.endedAt <= (before.lastTurn?.endedAt ?? -Infinity)) return;
      if (turn.outcome === "stopped" || state.suppressed) return;
      // A connector can report one turn's end and the next one's start at
      // once (a queued message). The owner moved on; only a failure is news.
      if (turn.outcome === "completed" && entry.runtimeStatus === "running") {
        this.cancel(state);
        return;
      }
      const event: AgentAttentionEvent = {
        sessionId: id,
        reason: turn.outcome,
        eventId: `${id}:${turn.endedAt}`,
        turn,
      };
      if (turn.outcome === "failed") {
        this.cancel(state);
        this.notify(event);
      } else {
        this.settle(state, event);
      }
      return;
    }
    // Connectors that predate turn summaries only report the status.
    if (
      turn === undefined &&
      before.runtimeStatus === "running" &&
      entry.runtimeStatus === "idle" &&
      !state.suppressed
    ) {
      this.settle(state, {
        sessionId: id,
        reason: "completed",
        eventId: `${id}:${Date.now()}`,
      });
    }
  }

  private settle(state: State, event: AgentAttentionEvent) {
    this.cancel(state);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.notify(event);
    }, this.settleMs);
    state.timer.unref?.();
  }

  private cancel(state: State) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
  }
}
