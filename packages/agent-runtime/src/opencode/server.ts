import {
  executeOnHost,
  openTcpTunnel,
  spawnOnHost,
  type AgentProcess,
  type AgentTcpTunnel,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const STARTUP_TIMEOUT_MS = 30_000;
const LISTENING_URL = /opencode server listening on http:\/\/127\.0\.0\.1:(\d{1,5})/iu;
const PREPARE_SERVER_DIRECTORY = `
set -eu
base="\${XDG_STATE_HOME:-\${HOME}/.local/state}"
directory="\${base}/overtchat/opencode-home"
umask 077
mkdir -p -- "\${directory}"
cd -- "\${directory}"
pwd -P
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

async function prepareServerDirectory(target: HostTarget): Promise<string> {
  const result = await executeOnHost(target, {
    command: "/bin/sh",
    args: ["-c", PREPARE_SERVER_DIRECTORY],
  });
  const directory = result.stdout.trim();
  if (!directory.startsWith("/")) {
    throw new Error("Unable to prepare a neutral OpenCode server directory.");
  }
  return directory;
}

async function startServer(
  target: HostTarget,
  executable: string,
): Promise<StartedServer> {
  const cwd = await prepareServerDirectory(target);
  const process = spawnOnHost(target, {
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
      process.kill("SIGTERM");
    }, STARTUP_TIMEOUT_MS);
  });

  let tunnel: AgentTcpTunnel;
  try {
    tunnel = await openTcpTunnel(target, remotePort);
  } catch (error) {
    process.kill("SIGTERM");
    throw new Error(`Unable to connect to the OpenCode server: ${errorMessage(error)}`);
  }
  const exit = process.exit.then((result) =>
    result.error ??
    new Error(
      stderr.trim() ||
        `OpenCode server exited (code ${result.code ?? "unknown"}, signal ${result.signal ?? "none"}).`,
    ),
  );
  return { process, tunnel, baseUrl: tunnel.url, exit };
}

export class OpenCodeServerPool {
  private readonly entries = new Map<string, PoolEntry>();

  async acquire(target: HostTarget, executable: string): Promise<OpenCodeServerLease> {
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
          await server?.tunnel.close().catch(() => {});
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
    await server.tunnel.close().catch(() => {});
    server.process.kill("SIGTERM");
    const timeout = setTimeout(() => server.process.kill("SIGKILL"), 1_000);
    timeout.unref();
    await server.process.exit.catch(() => {});
    clearTimeout(timeout);
  }
}

export const openCodeServerPool = new OpenCodeServerPool();
