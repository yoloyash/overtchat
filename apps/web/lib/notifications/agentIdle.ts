import type { AgentRuntimeStatus } from "@overtchat/agent-bridge";

/** Observes live status updates only; directory snapshots establish a baseline. */
export class AgentIdleNotifications {
  private states = new Map<
    string,
    {
      status: AgentRuntimeStatus;
      suppressed: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly notify: (id: string) => void,
    private readonly cancel: (id: string) => void,
    private readonly delayMs = 5_000,
  ) {}

  reset(id: string, status?: AgentRuntimeStatus) {
    const previous = this.states.get(id);
    if (previous?.timer) clearTimeout(previous.timer);
    this.states.delete(id);
    this.cancel(id);
    if (status) this.states.set(id, { status, suppressed: false });
  }

  suppress(id: string) {
    const state = this.states.get(id);
    if (state) {
      state.suppressed = true;
      if (state.timer) clearTimeout(state.timer);
    }
    this.cancel(id);
  }

  update(id: string, status: AgentRuntimeStatus) {
    const previous = this.states.get(id);
    if (!previous) {
      this.reset(id, status);
      return;
    }
    if (previous.status === status) return;
    if (previous.timer) clearTimeout(previous.timer);
    const state = {
      status,
      suppressed: status === "running" ? false : previous.suppressed,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    this.states.set(id, state);
    this.cancel(id);
    if (
      previous.status === "running" &&
      status === "idle" &&
      !state.suppressed
    ) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        this.notify(id);
      }, this.delayMs);
      state.timer.unref?.();
    }
  }
}
