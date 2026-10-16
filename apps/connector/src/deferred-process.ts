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
  let cancelled = false;
  let stopping: Promise<void> | undefined;
  const abort = new AbortController();
  const terminate = (): Promise<void> => {
    cancelled = true;
    abort.abort();
    if (!child) return ready.then(() => terminate());
    stopping ??= child.terminate
      ? child.terminate()
      : Promise.resolve().then(() => {
          child!.kill("SIGTERM");
        });
    return stopping;
  };
  const ready = Promise.resolve()
    .then(() => start(abort.signal))
    .then(async (process) => {
      child = process;
      process.stdout.pipe(stdout);
      process.stderr.pipe(stderr);
      // stdin errors are reflected in the process exit, never unhandled events.
      process.stdin.on("error", () => {});
      stdin.pipe(process.stdin);
      if (cancelled) await terminate();
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
    kill: () => {
      void terminate().catch(() => {
        /* startup failure is reported by exit */
      });
      return true;
    },
  };
}
