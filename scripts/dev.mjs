#!/usr/bin/env node
/* global AbortSignal, clearTimeout, console, fetch, process, setTimeout */

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export function devRuntimePaths(root = repositoryRoot) {
  const runtimeDirectory = path.join(root, ".overtchat-dev");
  const connectorDirectory = path.join(runtimeDirectory, "connector");
  return {
    runtimeDirectory,
    authSecret: path.join(runtimeDirectory, "auth-secret"),
    connectorDirectory,
    connectorConfig: path.join(connectorDirectory, "config.json"),
    connectorState: path.join(connectorDirectory, "state.json"),
    connectorTimelines: path.join(connectorDirectory, "timelines"),
    connectorLock: path.join(connectorDirectory, "connector.lock"),
  };
}

export function installedCapabilities(environment = process.env) {
  const configured = environment.OVERTCHAT_INSTALLED_CAPABILITIES;
  const capabilities = new Set(
    configured === undefined
      ? []
      : configured
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
  );
  capabilities.add("agents");
  return [...capabilities].join(",");
}

export function parseDevOptions(args) {
  const supported = new Set(["--web-only", "--reset-connector"]);
  const unexpected = args.find((argument) => !supported.has(argument));
  if (unexpected) throw new Error(`Unknown development option: ${unexpected}`);
  if (args.includes("--web-only") && args.includes("--reset-connector")) {
    throw new Error("--web-only and --reset-connector cannot be combined.");
  }
  return {
    webOnly: args.includes("--web-only"),
    resetConnector: args.includes("--reset-connector"),
  };
}

export function developmentPort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid development port: ${value}`);
  }
  return port;
}

async function assertPortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  }).catch((error) => {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Stop the existing development server or set OVERTCHAT_DEV_PORT.`,
      );
    }
    throw error;
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} ${
        result.signal ? `was stopped by ${result.signal}` : `exited with ${result.code}`
      }.`,
    );
  }
}

function startProcess(command, args, environment) {
  return spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
}

function processExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
  });
}

function signalProcess(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

class ProcessSupervisor {
  constructor() {
    this.children = new Map();
    this.stopping = false;
    this.exitCode = 0;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  add(label, child) {
    this.children.set(child, label);
    child.once("error", (error) => {
      if (this.stopping) return;
      console.error(`${label} could not start: ${error.message}`);
      void this.stop(1);
    });
    child.once("exit", (code, signal) => {
      this.children.delete(child);
      if (this.stopping) return;
      console.error(
        `${label} ${signal ? `was stopped by ${signal}` : `exited with ${code}`}.`,
      );
      void this.stop(code && code > 0 ? code : 1);
    });
    return child;
  }

  async stop(exitCode = 0) {
    if (this.stopping) return this.done;
    this.stopping = true;
    this.exitCode = exitCode;
    const children = [...this.children.keys()];
    for (const child of children) signalProcess(child, "SIGTERM");
    const graceful = Promise.all(children.map(processExit));
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(resolve, 5_000);
    });
    await Promise.race([graceful, timeout]);
    clearTimeout(timeoutId);
    for (const child of children) signalProcess(child, "SIGKILL");
    await Promise.all(children.map(processExit));
    this.resolveDone();
    return this.done;
  }
}

async function readOrCreateSecret(file) {
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("base64url");
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return secret;
}

async function writePrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

export function connectorIdentityChanged(existing, connectorId) {
  return (
    existing !== null &&
    (typeof existing !== "object" || existing.connectorId !== connectorId)
  );
}

async function prepareConnectorConfig(paths, config) {
  let existing = null;
  try {
    existing = JSON.parse(await readFile(paths.connectorConfig, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    if (error instanceof SyntaxError) existing = { invalid: true };
  }
  if (connectorIdentityChanged(existing, config.connectorId)) {
    const backup = `${paths.connectorDirectory}.backup-${new Date()
      .toISOString()
      .replaceAll(":", "-")}`;
    await rename(paths.connectorDirectory, backup);
    console.log(
      `The development connector identity changed; previous state moved to ${backup}`,
    );
  }
  await writePrivateJson(paths.connectorConfig, config);
}

async function activeLockPid(file) {
  let lock;
  try {
    lock = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
  if (!lock || !Number.isSafeInteger(lock.pid) || lock.pid <= 0) return null;
  try {
    process.kill(lock.pid, 0);
    return lock.pid;
  } catch (error) {
    if (error?.code === "ESRCH") return null;
    if (error?.code === "EPERM") return lock.pid;
    throw error;
  }
}

async function resetConnectorState(paths) {
  try {
    await stat(paths.connectorDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("Development Host Connector state is already empty.");
      return;
    }
    throw error;
  }
  if ((await activeLockPid(paths.connectorLock)) !== null) {
    throw new Error(
      "The development Host Connector is running. Stop npm run dev before resetting it.",
    );
  }
  const backup = `${paths.connectorDirectory}.backup-${new Date()
    .toISOString()
    .replaceAll(":", "-")}`;
  await rename(paths.connectorDirectory, backup);
  console.log(`Development Host Connector state moved to ${backup}`);
}

async function waitForManagementApi(serverUrl, managementSecret, webProcess) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (webProcess.exitCode !== null || webProcess.signalCode !== null) {
      throw new Error("The web development server stopped before it became ready.");
    }
    try {
      const response = await fetch(
        `${serverUrl}/api/internal/management/connector`,
        {
          headers: { Authorization: `Bearer ${managementSecret}` },
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (response.ok) return;
      if (response.status === 401) {
        throw new Error(
          "The web development server rejected its generated management secret.",
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("generated management secret")
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The web development server did not become ready within 60 seconds.");
}

async function provisionConnector(serverUrl, managementSecret, version) {
  const response = await fetch(
    `${serverUrl}/api/internal/management/connector`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${managementSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `${os.hostname()} (development)`,
        version,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (
    !response.ok ||
    !body ||
    typeof body.connectorId !== "string" ||
    typeof body.token !== "string"
  ) {
    throw new Error(
      body?.error ??
        `The web development server could not provision the Host Connector (HTTP ${response.status}).`,
    );
  }
  return body;
}

async function connectorVersion() {
  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "apps", "connector", "package.json"),
      "utf8",
    ),
  );
  if (typeof manifest.version !== "string") {
    throw new Error("The Host Connector package version is invalid.");
  }
  return manifest.version;
}

export async function runDevelopment(args = process.argv.slice(2)) {
  const options = parseDevOptions(args);
  const paths = devRuntimePaths();
  if (options.resetConnector) {
    await resetConnectorState(paths);
    return 0;
  }
  if (!options.webOnly && process.platform !== "linux") {
    throw new Error(
      "The Host Connector requires Linux. Use npm run dev:web on this platform.",
    );
  }

  const webPort = developmentPort(process.env.OVERTCHAT_DEV_PORT, 4717);
  const redisPort = developmentPort(
    process.env.OVERTCHAT_DEV_REDIS_PORT,
    6379,
  );
  await assertPortAvailable(webPort);
  if (!options.webOnly) {
    const connectorPid = await activeLockPid(paths.connectorLock);
    if (connectorPid !== null) {
      throw new Error(
        `A development Host Connector is already running (PID ${connectorPid}). Stop it before starting another development stack.`,
      );
    }
  }

  if (!options.webOnly) {
    console.log("Starting isolated development dependencies...");
    await runCommand("docker", [
      "compose",
      "-f",
      "compose.dev.yml",
      "up",
      "-d",
      "--wait",
      "redis",
    ]);
  }

  const authSecret = await readOrCreateSecret(paths.authSecret);
  const managementSecret = randomBytes(32).toString("base64url");
  const serverUrl = `http://127.0.0.1:${webPort}`;
  const webEnvironment = {
    ...process.env,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || authSecret,
    OVERTCHAT_MANAGEMENT_SECRET: managementSecret,
    HOST_CONNECTOR_URL: process.env.HOST_CONNECTOR_URL || serverUrl,
    PORT: String(webPort),
    ...(options.webOnly
      ? {}
      : {
          OVERTCHAT_INSTALLED_CAPABILITIES: installedCapabilities(),
          REDIS_URL: process.env.REDIS_URL || `redis://127.0.0.1:${redisPort}`,
        }),
  };

  const supervisor = new ProcessSupervisor();
  const stop = () => void supervisor.stop(0);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const web = supervisor.add(
      "Web development server",
      startProcess(
        npmCommand,
        ["run", "dev", "-w", "apps/web", "--"],
        webEnvironment,
      ),
    );
    if (!options.webOnly) {
      await waitForManagementApi(serverUrl, managementSecret, web);
      const version = await connectorVersion();
      const provisioned = await provisionConnector(
        serverUrl,
        managementSecret,
        version,
      );
      await prepareConnectorConfig(paths, {
        serverUrl,
        connectorId: provisioned.connectorId,
        token: provisioned.token,
      });
      const connectorEnvironment = {
        ...process.env,
        OVERTCHAT_CONNECTOR_CONFIG: paths.connectorConfig,
        OVERTCHAT_CONNECTOR_STATE: paths.connectorState,
        OVERTCHAT_CONNECTOR_TIMELINES: paths.connectorTimelines,
        OVERTCHAT_CONNECTOR_LOCK: paths.connectorLock,
      };
      supervisor.add(
        "Host Connector",
        startProcess(
          npmCommand,
          ["run", "dev", "-w", "apps/connector", "--", "run"],
          connectorEnvironment,
        ),
      );
      console.log(
        `OvertChat development is ready at ${serverUrl} with Agent Connections.`,
      );
    } else {
      console.log(`OvertChat web development is starting at ${serverUrl}.`);
    }
    await supervisor.done;
    return supervisor.exitCode;
  } catch (error) {
    await supervisor.stop(1);
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runDevelopment()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
