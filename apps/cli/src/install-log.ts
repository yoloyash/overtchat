import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { CLI_VERSION } from "./constants.js";
import { runtimePaths } from "./paths.js";

type LogContext = { file?: string; secrets: Set<string>; cleanup: Set<() => void> };
const context = new AsyncLocalStorage<LogContext>();

export function onInstallationFinished(cleanup: () => void): void {
  context.getStore()?.cleanup.add(cleanup);
}

export function installationLogPath(): string {
  return path.join(runtimePaths().configDirectory, "install.log");
}

export function protectInstallationSecrets(...values: Array<string | undefined>): void {
  for (const value of values) if (value) context.getStore()?.secrets.add(value);
}

export function installationMessage(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value);
  if (value instanceof AggregateError)
    text += `\n${value.errors.map(installationMessage).join("\n")}`;
  for (const secret of [...(context.getStore()?.secrets ?? [])].sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, "[redacted]");
  return text
    .replace(/\boct_[\w-]+\.[\w-]+/gu, "[redacted]")
    .replace(/(Bearer\s+)\S+/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/giu, "$1[redacted]");
}

// Diagnostics must never turn an otherwise recoverable installation into a failure.
export function logInstallation(message: string): void {
  const state = context.getStore();
  if (!state?.file) return;
  try {
    appendFileSync(state.file, `${new Date().toISOString()} ${installationMessage(message)}\n`, { mode: 0o600 });
  } catch {
    console.warn("Could not write the installation log; terminal output is still available.");
    state.file = undefined;
  }
}

export function installationLogHint(): string {
  const file = context.getStore()?.file;
  return file ? `Installation log: ${file}\nRead it with: overtchat logs install --tail 100` : "";
}

export async function withInstallationLog<T>(operation: string, run: () => Promise<T>): Promise<T> {
  if (context.getStore()) return run();
  const state: LogContext = { secrets: new Set(), cleanup: new Set() };
  try {
    const file = installationLogPath();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 5 * 1024 * 1024) {
      renameSync(file, `${file}.previous`);
      chmodSync(`${file}.previous`, 0o600);
    }
    appendFileSync(file, "", { mode: 0o600 });
    chmodSync(file, 0o600);
    state.file = file;
  } catch {
    console.warn("Could not create an installation log; terminal output is still available.");
  }
  return context.run(state, async () => {
    logInstallation(`Starting ${operation}, CLI ${CLI_VERSION} (${process.platform}/${process.arch})`);
    try {
      const result = await run();
      logInstallation(`Finished ${operation}`);
      return result;
    } catch (error) {
      const message = installationMessage(error);
      logInstallation(`Failed ${operation}: ${message}`);
      throw new Error([message, installationLogHint()].filter(Boolean).join("\n"), { cause: error });
    } finally {
      for (const cleanup of state.cleanup) cleanup();
    }
  });
}
