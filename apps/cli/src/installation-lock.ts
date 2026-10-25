import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { installationBinDirectory } from "./paths.js";
import { ProcessLock } from "./process-lock.js";
import { requireSuccessful } from "./process.js";

const context = new AsyncLocalStorage<ProcessLock>();

export async function withInstallationLock<T>(run: () => Promise<T>): Promise<T> {
  if (context.getStore()) return run();
  // The binary and services are shared even when config/stack paths differ.
  const lock = await ProcessLock.acquire(path.join(installationBinDirectory(), ".management.lock"));
  try { return await context.run(lock, run); }
  finally { await lock.release(); }
}

export async function runUpdatedCli(executable: string, args: string[]): Promise<void> {
  // The child reacquires the lock and rereads state. Never let two processes
  // share a lock: killing the parent must not make a live child look stale.
  await context.getStore()?.release();
  await requireSuccessful(executable, args, { inherit: true });
}
