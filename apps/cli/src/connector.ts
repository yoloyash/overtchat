import { BinaryUpdate } from "./binary-update.js";
import { ProcessLock } from "./process-lock.js";
import { releaseAsset } from "./platform.js";
import { executableName, installationBinDirectory, runtimePaths } from "./paths.js";
import { runPowerShell } from "./windows.js";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONNECTOR_REPOSITORY } from "./constants.js";
import {
  commandExists,
  requireSuccessful,
  runCommand,
  type RunOptions,
} from "./process.js";
import { installationMessage, logInstallation, protectInstallationSecrets } from "./install-log.js";
import type { InstallationConfig } from "./types.js";
import { pruneConnectorRuntimes, stageConnectorPackage } from "./connector-package.js";

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function expectedChecksum(contents: string, asset: string): string {
  for (const line of contents.split(/\r?\n/u)) {
    const [checksum, filename] = line.trim().split(/\s+/u);
    if (filename?.replace(/^\*/u, "") === asset && checksum) return checksum;
  }
  throw new Error(`The connector checksum for ${asset} is missing.`);
}

/** Run a connector launcher; Windows executes its batch launcher through cmd.exe. */
function runConnector(launcher: string, args: string[], options: RunOptions = {}) {
  if (process.platform !== "win32") return requireSuccessful(launcher, args, options);
  // Arguments are fixed subcommands. /s strips only the outer quotes.
  if (args.some((arg) => !/^[a-z-]+$/u.test(arg))) throw new Error("Invalid connector command.");
  return requireSuccessful(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${launcher}" ${args.join(" ")}"`], {
    ...options, windowsVerbatimArguments: true,
  });
}

async function stageConnectorBinary(
  version: string,
  progress: (message: string) => void,
): Promise<{ temporaryDirectory: string; binary: string; payloadDirectory?: string }> {
  const override = process.env.OVERTCHAT_CONNECTOR_BINARY?.trim();
  const packageOverride = process.env.OVERTCHAT_CONNECTOR_PACKAGE?.trim();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-connector-"),
  );
  const staged = path.join(temporaryDirectory, executableName("overtchat-connector"));
  try {
    if (packageOverride) {
      return { temporaryDirectory, ...await stageConnectorPackage(packageOverride, temporaryDirectory, version) };
    }
    if (override) {
      if (process.platform === "win32") throw new Error("On Windows, set OVERTCHAT_CONNECTOR_PACKAGE to a connector archive.");
      await copyFile(override, staged);
      await chmod(staged, 0o755);
      return { temporaryDirectory, binary: staged };
    }
    const assetBase = releaseAsset("overtchat-connector");
    const releaseBase = `https://github.com/${CONNECTOR_REPOSITORY}/releases/download/connector-v${version}`;
    const checksums = new TextDecoder().decode(await download(`${releaseBase}/connector-checksums.txt`));
    const archiveAsset = `${assetBase}.tar.gz`;
    const packaged = checksums.split(/\r?\n/u).some((line) => line.trim().split(/\s+/u)[1]?.replace(/^\*/u, "") === archiveAsset);
    if (!packaged && process.platform === "win32") throw new Error(`Agent Connector ${version} does not support Windows.`);
    const asset = packaged ? archiveAsset : assetBase;
    const binary = await download(`${releaseBase}/${asset}`);
    progress("Verifying Agent Connector download");
    const expected = expectedChecksum(checksums, asset);
    const actual = createHash("sha256").update(binary).digest("hex");
    if (actual !== expected) {
      throw new Error("The downloaded Agent Connector failed checksum verification.");
    }
    if (packaged) {
      const archive = path.join(temporaryDirectory, asset);
      await writeFile(archive, binary, { mode: 0o600 });
      return { temporaryDirectory, ...await stageConnectorPackage(archive, temporaryDirectory, version) };
    }
    await writeFile(staged, binary, { mode: 0o755 });
    await chmod(staged, 0o755);
    return { temporaryDirectory, binary: staged };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function provisionConnector(
  config: InstallationConfig,
  managementSecret: string,
): Promise<{ connectorId: string; token: string }> {
  const response = await fetch(
    `http://127.0.0.1:${config.appPort}/api/internal/management/connector`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${managementSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: os.hostname(),
        version: config.connectorVersion,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    connectorId?: string;
    token?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.connectorId || !body.token) {
    throw new Error(
      body?.error ??
        `OvertChat could not provision Agent Connections (HTTP ${response.status}).`,
    );
  }
  return { connectorId: body.connectorId, token: body.token };
}

async function waitForConnector(
  config: InstallationConfig,
  managementSecret: string,
  expected: { connectorId: string; version: string },
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${config.appPort}/api/internal/management/connector`,
      {
        headers: { Authorization: `Bearer ${managementSecret}` },
        signal: AbortSignal.timeout(5_000),
      },
    ).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as {
        connector?: { id?: string; version?: string; online?: boolean } | null;
      };
      if (body.connector?.online && body.connector.id === expected.connectorId && body.connector.version === expected.version) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("The Agent Connector service started but did not come online.");
}

export type ConnectorInstallOptions = {
  onProgress?: (message: string) => void;
  interactive?: boolean;
  permission?: (run: () => Promise<void>) => Promise<void>;
};

async function ensureUserLinger(options: ConnectorInstallOptions): Promise<void> {
  if (!(await commandExists("loginctl"))) return;
  const username = os.userInfo().username;
  const current = await runCommand("loginctl", [
    "show-user",
    username,
    "--property=Linger",
    "--value",
  ], { timeoutMs: 10_000 });
  if (current.exitCode === 0 && current.stdout.trim() === "yes") return;
  const direct = await runCommand("loginctl", ["--no-ask-password", "enable-linger", username], { timeoutMs: 10_000 });
  if (direct.exitCode === 0) return;
  if (!(await commandExists("sudo"))) {
    throw new Error(
      "Agent Connections need user lingering enabled so they stay online after logout.",
    );
  }
  const enable = async () => {
    await requireSuccessful("sudo", [
      ...(options.interactive ? [] : ["-n"]), "loginctl", "enable-linger", username,
    ], { inherit: true, timeoutMs: 120_000 });
  };
  if (options.permission) await options.permission(enable);
  else await enable();
}

export async function checkManagedConnectorPrerequisites(): Promise<void> {
  if (process.platform === "win32") {
    const check = await runPowerShell(`
if ((Get-Service Schedule).Status -ne 'Running') { throw 'Windows Task Scheduler is not running.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($sid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'Run setup as your desktop user.' }`);
    if (check.exitCode !== 0) throw new Error("Agent Connections require Windows Task Scheduler and a signed-in desktop user. " + check.stderr.trim());
    return;
  }
  if (process.getuid?.() === 0 && (process.env.SUDO_USER || process.platform === "darwin")) {
    throw new Error(
      "Run overtchat setup as your normal user. It will request elevated permissions only when needed.",
    );
  }
  const serviceCheck = process.platform === "darwin"
    ? await runCommand("launchctl", ["print", `gui/${process.getuid!()}`], { timeoutMs: 10_000 })
    : await runCommand("systemctl", ["--user", "show-environment"], { timeoutMs: 10_000 });
  if (serviceCheck.exitCode !== 0) {
    throw new Error(
      process.platform === "darwin"
        ? "Agent Connections require a logged-in macOS desktop session. Run setup as that user without sudo."
        : "Agent Connections require a running systemd user session on this machine.",
    );
  }
}

export function managedConnectorEnvironment(): NodeJS.ProcessEnv {
  return process.platform === "win32" ? {
    ...process.env,
    OVERTCHAT_CONNECTOR_CONFIG: process.env.OVERTCHAT_CONNECTOR_CONFIG || path.join(runtimePaths().configDirectory, "connector.json"),
  } : process.env;
}

export function windowsConnectorLogDirectory(): string {
  return path.join(path.dirname(managedConnectorEnvironment().OVERTCHAT_CONNECTOR_CONFIG!), "windows-service");
}

async function savedConnectorCredentials(): Promise<{ connectorId: string; token: string } | null> {
  const file = managedConnectorEnvironment().OVERTCHAT_CONNECTOR_CONFIG ||
    path.join(os.homedir(), ".config", "overtchat", "connector.json");
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  // Never rotate a working server credential just to upgrade an executable.
  // Refuse malformed existing state rather than silently replacing pairing.
  let value: { connectorId?: string; token?: string };
  try { value = JSON.parse(raw); }
  catch { throw new Error(`Invalid connector configuration at ${file}. Restore its backup before retrying.`); }
  if (!value || typeof value.connectorId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.connectorId) ||
      typeof value.token !== "string" || !value.token.startsWith(`oct_${value.connectorId}.`))
    throw new Error(`Invalid connector configuration at ${file}. Restore its backup before retrying.`);
  protectInstallationSecrets(value.token);
  return { connectorId: value.connectorId, token: value.token };
}

export async function installManagedConnector(
  config: InstallationConfig,
  managementSecret: string,
  options: ConnectorInstallOptions = {},
): Promise<void> {
  const installPath = path.join(installationBinDirectory(), executableName("overtchat-connector"));
  const lock = await ProcessLock.acquire(`${installPath}.update.lock`);
  try { await installConnectorLocked(installPath, config, managementSecret, options); }
  finally { await lock.release(); }
}

async function installConnectorLocked(
  installPath: string,
  config: InstallationConfig,
  managementSecret: string,
  options: ConnectorInstallOptions,
): Promise<void> {
  protectInstallationSecrets(managementSecret);
  logInstallation(`Requested Agent Connector version: ${config.connectorVersion}`);
  let phase = "Installing Agent Connections";
  const progress = (message: string) => {
    phase = message;
    logInstallation(message);
    options.onProgress?.(message);
  };
  const environment = managedConnectorEnvironment();
  const transaction = new BinaryUpdate(installPath);
  const restartPrevious = async () => {
    if (process.platform === "linux") {
      await requireSuccessful("systemctl", ["--user", "restart", "overtchat-connector.service"], { timeoutMs: 120_000 });
    } else await runConnector(installPath, ["service-install"], { environment, timeoutMs: 120_000 });
    const credentials = await savedConnectorCredentials();
    if (!credentials) throw new Error("The previous connector has no saved pairing to recover.");
    const version = (await runConnector(installPath, ["version"], { timeoutMs: 10_000 })).stdout.trim();
    await waitForConnector(config, managementSecret, { connectorId: credentials.connectorId, version });
  };
  const recover = async () => {
    if (transaction.committed) { await transaction.finish(); return; }
    if (process.platform === "win32") {
      // The target can be absent between the two Windows renames. The backup
      // can still issue the normal graceful-stop protocol for this config.
      const executable = await readFile(installPath).then(() => installPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return transaction.hadPrevious ? transaction.backup : null;
        throw error;
      });
      if (executable) await runConnector(executable, ["service-stop"], { environment, timeoutMs: 60_000 });
    } else if (process.platform === "darwin") {
      await runCommand("launchctl", ["bootout", `gui/${process.getuid!()}/com.overtchat.connector`], { timeoutMs: 20_000 });
    } else await runCommand("systemctl", ["--user", "stop", "overtchat-connector.service"], { timeoutMs: 20_000 });
    await transaction.restore();
    if (transaction.hadPrevious) await restartPrevious();
    await transaction.finish();
  };
  let staged: Awaited<ReturnType<typeof stageConnectorBinary>> | undefined;
  try {
    progress("Checking Agent Connector service support");
    await checkManagedConnectorPrerequisites();
    if (await transaction.pending()) {
      progress("Recovering interrupted Agent Connector update");
      await recover();
    }
    if (process.platform === "linux") {
      progress("Configuring Agent Connector background permissions");
      await ensureUserLinger(options);
    }
    const saved = await savedConnectorCredentials();
    progress("Downloading Agent Connector");
    staged = await stageConnectorBinary(config.connectorVersion, progress);
    progress("Checking Agent Connector executable");
    const preflight = await runConnector(staged.binary, ["version"], { timeoutMs: 10_000 });
    if (preflight.stdout.trim() !== config.connectorVersion)
      throw new Error("The downloaded Agent Connector failed its version check.");
    await mkdir(path.dirname(installPath), { recursive: true, mode: 0o700 });
    await transaction.prepare(staged.binary);
    if (process.platform === "win32" && transaction.hadPrevious) {
      progress("Stopping the previous Agent Connector");
      await runConnector(installPath, ["service-stop"], { environment, timeoutMs: 60_000 });
    }
    await transaction.replace();
    progress("Configuring Agent Connector connection");
    const provisioned = saved ?? await provisionConnector(config, managementSecret);
    protectInstallationSecrets(provisioned.token);
    progress("Starting Agent Connector service");
    await runConnector(installPath, ["install-managed"], {
      timeoutMs: 120_000, environment,
      input: `${JSON.stringify({ serverUrl: `http://127.0.0.1:${config.appPort}`, ...provisioned })}\n`,
    });
    progress("Waiting for Agent Connector connection");
    await waitForConnector(config, managementSecret, { connectorId: provisioned.connectorId, version: config.connectorVersion });
    await transaction.commit();
    logInstallation("Agent Connector connected");
  } catch (error) {
    const failedPhase = phase;
    if (await transaction.pending()) {
      await captureConnectorDiagnostics();
      progress("Recovering Agent Connector installation");
      try { await recover(); }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError],
          `${failedPhase}: ${installationMessage(error)}. Recovery failed: ${installationMessage(recoveryError)}. Recovery state is retained at ${transaction.journal}; rerun overtchat setup or update to retry.`);
      }
    }
    throw new Error(`${failedPhase}: ${installationMessage(error)}`, { cause: error });
  } finally {
    if (staged) await rm(staged.temporaryDirectory, { recursive: true, force: true });
    // Keep the runtimes of the installed, backup, and staged launchers.
    await pruneConnectorRuntimes([installPath, transaction.backup, transaction.staged]).catch((error) => {
      logInstallation(`Could not remove unused Agent Connector runtimes: ${installationMessage(error)}`);
    });
  }
}

async function captureConnectorDiagnostics(): Promise<void> {
  try {
    const result = process.platform === "win32"
      ? { stdout: (await Promise.all(["connector.log", "connector.error.log"].map(async (file) =>
          (await readFile(path.join(windowsConnectorLogDirectory(), file), "utf8").catch(() => "")).split(/\r?\n/u).slice(-20).join("\n")))).join("\n"), stderr: "" }
      : process.platform === "darwin"
      ? await runCommand("tail", ["-n", "20", ...["connector.log", "connector.error.log"].map(file =>
          path.join(os.homedir(), "Library", "Logs", "OvertChat", file))], { timeoutMs: 5_000 })
      : await runCommand("journalctl", ["--user", "-u", "overtchat-connector.service", "--no-pager", "-n", "20"], { timeoutMs: 5_000 });
    const output = installationMessage(result.stdout || result.stderr).slice(-16_384);
    if (output.trim()) {
      logInstallation(`Recent Agent Connector output:\n${output}`);
      console.error(`Recent Agent Connector output:\n${output}`);
    }
  } catch {
    logInstallation("Could not read Agent Connector service logs.");
  }
}
