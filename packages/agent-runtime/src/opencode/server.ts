import {
  executeOnHost,
  openTcpTunnel,
  spawnManagedOnHost,
  terminateAgentProcess,
  type AgentProcess,
  type AgentTcpTunnel,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";
import { isAbsoluteAgentPath } from "@overtchat/agent-bridge";

const STARTUP_TIMEOUT_MS = 30_000;
const LISTENING_URL =
  /opencode server listening on http:\/\/127\.0\.0\.1:(\d{1,5})/iu;
// Runs on the host: a private working directory for the server, and a port
// that is free there right now.
const PREPARE_SERVER = `
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), net = require("node:net");
const base = process.env.XDG_STATE_HOME || (process.platform === "win32" ? process.env.LOCALAPPDATA : null) || path.join(os.homedir(), ".local", "state");
const directory = path.join(base, "overtchat", "opencode-home");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const probe = net.createServer();
probe.listen(0, "127.0.0.1", () => {
  const { port } = probe.address();
  probe.close(() => process.stdout.write(JSON.stringify({ directory: fs.realpathSync(directory), port })));
});
`.trim();

export type OpenCodeServerLease = {
  baseUrl: string;
  exit: Promise<Error>;
  release(): Promise<void>;
};

type StartedServer = {
  process: AgentProcess;
  tunnel: AgentTcpTunnel;
  baseUrl: string;
  exit: Promise<Error>;
};

type PoolEntry = {
  references: number;
  start: Promise<StartedServer>;
};

function targetKey(target: HostTarget, executable: string): string {
  return JSON.stringify({
    transport: target.transport,
    alias: target.transport === "ssh" ? target.alias : null,
    shellMode: target.shellMode ?? "interactive",
    executable,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where the server runs and which port it listens on.
 *
 * Left to choose, OpenCode takes port 4096 whenever it is free, so a server
 * started after another stopped has the same address. A connection the HTTP
 * client opened to the old server but had not used yet survives its exit,
 * because OpenCode accepts a connection only once data arrives on it, and the
 * first request to the new server is sent down that dead connection and
 * reset. A port of its own gives every server a different address.
 */
async function prepareServer(
  target: HostTarget,
): Promise<{ directory: string; port: number }> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", PREPARE_SERVER],
  });
  let prepared: unknown;
  try {
    prepared = JSON.parse(result.stdout);
  } catch {
    prepared = null;
  }
  const directory =
    prepared && typeof prepared === "object"
      ? Reflect.get(prepared, "directory")
      : undefined;
  const port =
    prepared && typeof prepared === "object"
      ? Reflect.get(prepared, "port")
      : undefined;
  if (typeof directory !== "string" || !isAbsoluteAgentPath(directory)) {
    throw new Error("Unable to prepare a neutral OpenCode server directory.");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Unable to reserve a port for the OpenCode server.");
  }
  return { directory, port };
}

async function startServer(
  target: HostTarget,
  executable: string,
): Promise<StartedServer> {
  const { directory: cwd, port } = await prepareServer(target);
  const process = await spawnManagedOnHost(target, {
    command: executable,
    args: [
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
      "--print-logs",
      "--log-level",
      "INFO",
    ],
    cwd,
    env: { OPENCODE_SERVER_PASSWORD: "" },
  });
  process.stdin.end();
  let stdout = "";
  let stderr = "";
  const append = (current: string, chunk: Buffer | string) =>
    (current + chunk.toString()).slice(-16_384);
  process.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  process.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });

  let tunnel: AgentTcpTunnel | undefined;
  try {
    const remotePort = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (value: number | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        process.stdout.removeListener("data", inspect);
        process.stderr.removeListener("data", inspect);
        if (value instanceof Error) reject(value);
        else resolve(value);
      };
      const inspect = () => {
        const match = LISTENING_URL.exec(`${stdout}\n${stderr}`);
        const port = Number(match?.[1]);
        if (Number.isInteger(port) && port > 0 && port <= 65_535) finish(port);
      };
      process.stdout.on("data", inspect);
      process.stderr.on("data", inspect);
      void process.exit.then((result) => {
        finish(
          new Error(
            result.error?.message ||
              stderr.trim() ||
              stdout.trim() ||
              `OpenCode server exited before becoming ready (code ${result.code ?? "unknown"}).`,
          ),
        );
      });
      const timeout = setTimeout(() => {
        finish(
          new Error(
            `OpenCode server did not become ready within ${STARTUP_TIMEOUT_MS / 1_000} seconds.${
              stderr.trim() ? ` ${stderr.trim()}` : ""
            }`,
          ),
        );
      }, STARTUP_TIMEOUT_MS);
    });

    tunnel = await openTcpTunnel(target, remotePort);
    const exit = process.exit.then(
      (result) =>
        result.error ??
        new Error(
          stderr.trim() ||
            `OpenCode server exited (code ${result.code ?? "unknown"}, signal ${result.signal ?? "none"}).`,
        ),
    );
    return { process, tunnel, baseUrl: tunnel.url, exit };
  } catch (error) {
    await terminateAgentProcess(process).catch((cleanupError) => {
      console.error(
        `Unable to stop failed OpenCode server: ${errorMessage(cleanupError)}`,
      );
    });
    await tunnel?.close().catch(() => {});
    throw error;
  }
}

export class OpenCodeServerPool {
  private readonly entries = new Map<string, PoolEntry>();

  async acquire(
    target: HostTarget,
    executable: string,
  ): Promise<OpenCodeServerLease> {
    const key = targetKey(target, executable);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { references: 0, start: startServer(target, executable) };
      this.entries.set(key, entry);
      void entry.start
        .then((server) => server.exit)
        .then(async () => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          const server = await entry!.start.catch(() => null);
          if (server) {
            await terminateAgentProcess(server.process).catch((error) => {
              console.error(
                `Unable to clean up exited OpenCode server: ${errorMessage(error)}`,
              );
            });
            await server.tunnel.close().catch(() => {});
          }
        })
        .catch(() => {});
    }
    entry.references += 1;
    let server: StartedServer;
    try {
      server = await entry.start;
    } catch (error) {
      entry.references -= 1;
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
    let releasePromise: Promise<void> | null = null;
    return {
      baseUrl: server.baseUrl,
      exit: server.exit,
      release: () => {
        if (releasePromise) return releasePromise;
        releasePromise = this.release(key, entry!, server);
        return releasePromise;
      },
    };
  }

  private async release(
    key: string,
    entry: PoolEntry,
    server: StartedServer,
  ): Promise<void> {
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references > 0 || this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    try {
      await terminateAgentProcess(server.process);
    } finally {
      await server.tunnel.close().catch(() => {});
    }
  }
}

export const openCodeServerPool = new OpenCodeServerPool();
