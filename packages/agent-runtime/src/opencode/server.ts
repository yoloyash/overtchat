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
import { Agent, fetch as fetchOver } from "undici";

const STARTUP_TIMEOUT_MS = 30_000;
const LISTENING_URL =
  /opencode server listening on http:\/\/127\.0\.0\.1:(\d{1,5})/iu;
const PREPARE_SERVER_DIRECTORY = `
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const base = process.env.XDG_STATE_HOME || (process.platform === "win32" ? process.env.LOCALAPPDATA : null) || path.join(os.homedir(), ".local", "state");
const directory = path.join(base, "overtchat", "opencode-home");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
process.stdout.write(fs.realpathSync(directory));
`.trim();

export type OpenCodeServerLease = {
  baseUrl: string;
  /** Sends a request over connections that end with this server. */
  fetch: typeof fetch;
  exit: Promise<Error>;
  release(): Promise<void>;
};

type StartedServer = {
  process: AgentProcess;
  tunnel: AgentTcpTunnel;
  baseUrl: string;
  connections: Agent;
  fetch: typeof fetch;
  exit: Promise<Error>;
};

/**
 * A fetch whose connections belong to one server.
 *
 * The pool behind the global fetch outlives a server. OpenCode accepts a
 * connection only once data arrives on it, so a connection the pool opened
 * but had not used yet hears nothing when the server exits. The next server
 * takes the same port, and the first request to it rides that dead connection
 * and is reset. Closing a server's connections with it leaves none to reuse.
 */
function serverFetch(connections: Agent): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers: Array<[string, string]> = [];
    request.headers.forEach((value, name) => headers.push([name, value]));
    const response = await fetchOver(request.url, {
      method: request.method,
      headers,
      // Buffered so the request keeps a Content-Length, as it has with the
      // global fetch.
      body: request.body ? await request.arrayBuffer() : undefined,
      signal: request.signal,
      dispatcher: connections,
    });
    return response as unknown as Response;
  };
}

async function stopServer(server: StartedServer): Promise<void> {
  try {
    await terminateAgentProcess(server.process);
  } finally {
    await server.connections.destroy().catch(() => {});
    await server.tunnel.close().catch(() => {});
  }
}

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

async function prepareServerDirectory(target: HostTarget): Promise<string> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", PREPARE_SERVER_DIRECTORY],
  });
  const directory = result.stdout.trim();
  if (!isAbsoluteAgentPath(directory)) {
    throw new Error("Unable to prepare a neutral OpenCode server directory.");
  }
  return directory;
}

async function startServer(
  target: HostTarget,
  executable: string,
): Promise<StartedServer> {
  const cwd = await prepareServerDirectory(target);
  const process = await spawnManagedOnHost(target, {
    command: executable,
    args: [
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
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
    const connections = new Agent();
    return {
      process,
      tunnel,
      baseUrl: tunnel.url,
      connections,
      fetch: serverFetch(connections),
      exit,
    };
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
            await stopServer(server).catch((error) => {
              console.error(
                `Unable to clean up exited OpenCode server: ${errorMessage(error)}`,
              );
            });
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
      fetch: server.fetch,
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
    await stopServer(server);
  }
}

export const openCodeServerPool = new OpenCodeServerPool();
