import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { LocalServer } from "../shared/ipc";
import type { ServerProbe } from "./server-probe";

const DISCOVERY_TIMEOUT_MS = 1_500;

/** Only the manager's public installation state is read, never stack.env. */
export async function localServerOrigins(environment = process.env): Promise<string[]> {
  const home = environment.OVERTCHAT_HOME?.trim() || homedir();
  const directory = environment.OVERTCHAT_CONFIG_DIR?.trim() || path.join(home, ".config", "overtchat");
  const ports = new Set([4718, 4717]);
  try {
    const config: unknown = JSON.parse(await readFile(path.join(directory, "installation.json"), "utf8"));
    if (config && typeof config === "object" && "format" in config && config.format === 1 && "appPort" in config) {
      const port = config.appPort;
      if (typeof port === "number" && Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
        ports.add(port);
      }
    }
  } catch {
    // Manual/source installations may have no manager state, or unreadable state.
  }
  return [...ports].map((port) => `http://localhost:${port}`);
}

/** Probes run concurrently; discovery never follows redirects off this PC. */
export async function discoverLocalServers(
  ping: ServerProbe,
  environment = process.env,
): Promise<LocalServer[]> {
  const origins = await localServerOrigins(environment);
  const results = await Promise.all(origins.map(async (origin): Promise<LocalServer | null> => {
    try {
      const result = await ping(origin, { timeoutMs: DISCOVERY_TIMEOUT_MS, redirect: "error" });
      return result.ok ? { origin, version: result.version, problem: result.problem } : null;
    } catch {
      return null;
    }
  }));
  return results.filter((server): server is LocalServer => server !== null);
}
