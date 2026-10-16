import { PassThrough } from "node:stream";
import type { AgentProcess, AgentProcessExit } from "@overtchat/agent-runtime";

/** Preserve the synchronous stream interface while SSH capabilities are probed. */
export function deferredProcess(
  start: (signal: AbortSignal) => Promise<AgentProcess>,
): AgentProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let child: AgentProcess | undefined;
  let pendingSignal: NodeJS.Signals | undefined;
  let terminating = false;
  let stopping: Promise<void> | undefined;
  const abort = new AbortController();
  const stopChild = async (process: AgentProcess): Promise<void> => {
    if (process.terminate) await process.terminate();
    else {
      process.kill("SIGTERM");
      const timer = setTimeout(() => process.kill("SIGKILL"), 1_000);
      try {
        await process.exit;
      } finally {
        clearTimeout(timer);
      }
    }
    await process.exit;
  };
  const terminate = (): Promise<void> => {
    terminating = true;
    abort.abort();
    stopping ??= ready.then(
      () => stopChild(child!),
      () => {},
    );
    return stopping;
  };
  const ready = Promise.resolve()
    .then(() => start(abort.signal))
    .then((process) => {
      child = process;
      process.stdout.pipe(stdout);
      process.stderr.pipe(stderr);
      // stdin errors are reflected in the process exit, never unhandled events.
      process.stdin.on("error", () => {});
      // A cancelled launch must not receive buffered requests before cleanup.
      if (terminating || pendingSignal) {
        stdin.destroy();
        if (pendingSignal) process.kill(pendingSignal);
      } else stdin.pipe(process.stdin);
    });
  const exit: Promise<AgentProcessExit> = ready
    .then(() => child!.exit)
    .catch((error) => {
      stderr.end(error instanceof Error ? error.message : String(error));
      stdout.end();
      stdin.destroy();
      return {
        code: 1,
        signal: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    });
  return {
    stdin,
    stdout,
    stderr,
    exit,
    terminate,
    kill: (signal = "SIGTERM") => {
      if (child) return child.kill(signal);
      if (pendingSignal !== "SIGKILL") pendingSignal = signal;
      abort.abort();
      return true;
    },
  };
}
