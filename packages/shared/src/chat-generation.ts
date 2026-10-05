import type { ChatGenerationState } from "./chat";

interface GenerationAdapter {
  temporary(): boolean;
  read(signal: AbortSignal): Promise<ChatGenerationState | null>;
  cancel(signal: AbortSignal): Promise<void>;
  stopReader(): void | Promise<void>;
  resumeReader(): Promise<void>;
  apply(state: ChatGenerationState): void;
  foreground(): boolean;
}

type Job = {
  kind: "recover" | "prepare" | "cancel";
  controller: AbortController;
  promise: Promise<boolean>;
};

function check(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Generation operation cancelled");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Generation operation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function delay(signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve, reject) => {
    check(signal);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Generation operation cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One owner for recovery, queue admission, and cancellation. No platform I/O. */
export class ChatGenerationCoordinator {
  private job: Job | null = null;
  private attached = false;
  private statusListeners = new Set<() => void>();

  private adapter!: GenerationAdapter;

  constructor(private status: string) {}

  attach(adapter: GenerationAdapter) {
    this.adapter = adapter;
    this.attached = true;
    return () => {
      this.attached = false;
      this.job?.controller.abort();
      this.job = null;
      // Detach the reader only. Saved inference continues on the server.
      void adapter.stopReader();
    };
  }

  observeStatus(status: string) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }

  private waitForStatus(predicate: () => boolean, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.statusListeners.delete(changed);
        signal.removeEventListener("abort", aborted);
      };
      const changed = () => {
        if (predicate()) {
          cleanup();
          resolve();
        }
      };
      const aborted = () => {
        cleanup();
        reject(new Error("Generation operation cancelled"));
      };
      this.statusListeners.add(changed);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      else changed();
    });
  }

  private async stopReader(signal: AbortSignal) {
    await abortable(Promise.resolve(this.adapter.stopReader()), signal);
    // SDK stop() requests an abort; the status notification confirms onFinish
    // has run. This wait uses events rather than polling React render state.
    await this.waitForStatus(
      () => this.status !== "submitted" && this.status !== "streaming",
      signal,
    );
  }

  private run(
    kind: Job["kind"],
    external: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<boolean>,
  ) {
    if (!this.attached)
      return Promise.reject(new Error("Generation view detached"));
    if (kind === "recover" && this.job) return this.job.promise;
    this.job?.controller.abort();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    external?.addEventListener("abort", cancel, { once: true });
    if (external?.aborted) cancel();
    // Bound cancellation even if a request or reader never settles. Recovery
    // and ordinary queue waits may last as long as the server generation.
    const timeout = kind === "cancel" ? setTimeout(cancel, 30_000) : undefined;
    const job: Job = { kind, controller, promise: Promise.resolve(false) };
    this.job = job;
    job.promise = Promise.resolve()
      .then(() => {
        check(controller.signal);
        return abortable(task(controller.signal), controller.signal);
      })
      .finally(() => {
        clearTimeout(timeout);
        external?.removeEventListener("abort", cancel);
        if (this.job === job) this.job = null;
      });
    return job.promise;
  }

  reconcile = async () => {
    await this.run("recover", undefined, async (signal) => {
      if (this.adapter.temporary()) return true;
      let resumed = false;
      while (true) {
        const state = await this.adapter.read(signal);
        check(signal);
        if (!state) return true;
        if (!state.active) {
          await this.stopReader(signal);
          check(signal);
          this.adapter.apply(state);
          return true;
        }
        if (!resumed) {
          await this.stopReader(signal);
          check(signal);
          // Server state remains authoritative if this reader hangs. Never
          // serialize another operation behind the lifetime of an SSE fetch.
          void this.adapter.resumeReader().catch(() => undefined);
          resumed = true;
        }
        if (!this.adapter.foreground()) return true;
        await delay(signal, 1_500);
      }
    });
  };

  prepare = async (
    signal: AbortSignal,
    explicit: boolean,
  ): Promise<boolean> => {
    // Automatic admission joins recovery/cancellation. Only an explicit cancel
    // may preempt them; this prevents ready-status renders from cutting off a
    // reconnect before it has restored the live reader.
    while (this.job) {
      const preceding = this.job;
      try {
        await abortable(preceding.promise, signal);
      } catch (error) {
        check(signal);
        if (!preceding.controller.signal.aborted) throw error;
      }
    }
    check(signal);
    return this.run("prepare", signal, async (signal) => {
      if (this.adapter.temporary()) {
        await this.waitForStatus(
          () => this.status !== "submitted" && this.status !== "streaming",
          signal,
        );
        return true;
      }
      while (true) {
        const state = await this.adapter.read(signal);
        check(signal);
        if (!state) return explicit;
        if (!state.active && this.status !== "submitted") {
          await this.stopReader(signal);
          check(signal);
          this.adapter.apply(state);
          return (
            explicit || (state.status !== "aborted" && state.status !== "error")
          );
        }
        await delay(signal, 1_500);
      }
    });
  };

  cancel = async (external?: AbortSignal) => {
    await this.run("cancel", external, async (signal) => {
      if (this.adapter.temporary()) {
        await this.stopReader(signal);
        return true;
      }
      let cancelledStream: string | null = null;
      while (true) {
        const state = await this.adapter.read(signal);
        check(signal);
        // An initial submit can be in flight before its server row exists.
        if (!state?.active && this.status !== "submitted") {
          await this.stopReader(signal);
          check(signal);
          if (state) this.adapter.apply(state);
          return true;
        }
        if (state?.active && state.streamId !== cancelledStream) {
          await this.adapter.cancel(signal);
          check(signal);
          cancelledStream = state.streamId;
        }
        await delay(signal, 250);
      }
    });
  };
}
