import { releaseAsset } from "./platform.js";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
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
} from "./process.js";
import { installationMessage, logInstallation, protectInstallationSecrets } from "./install-log.js";
import type { InstallationConfig } from "./types.js";
import { stageConnectorPackage } from "./connector-package.js";

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

async function stageConnectorBinary(
  version: string,
  progress: (message: string) => void,
): Promise<{ temporaryDirectory: string; binary: string; payloadDirectory?: string }> {
  const override = process.env.OVERTCHAT_CONNECTOR_BINARY?.trim();
  const packageOverride = process.env.OVERTCHAT_CONNECTOR_PACKAGE?.trim();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-connector-"),
  );
  const staged = path.join(temporaryDirectory, "overtchat-connector");
  try {
    if (packageOverride) {
      return { temporaryDirectory, ...await stageConnectorPackage(packageOverride, temporaryDirectory, version) };
    }
    if (override) {
      await copyFile(override, staged);
      await chmod(staged, 0o755);
      return { temporaryDirectory, binary: staged };
    }
    const assetBase = releaseAsset("overtchat-connector");
    const releaseBase = `https://github.com/${CONNECTOR_REPOSITORY}/releases/download/connector-v${version}`;
    const checksums = new TextDecoder().decode(await download(`${releaseBase}/connector-checksums.txt`));
    const archiveAsset = `${assetBase}.tar.gz`;
    const packaged = checksums.split(/\r?\n/u).some((line) => line.trim().split(/\s+/u)[1]?.replace(/^\*/u, "") === archiveAsset);
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
        connector?: { online?: boolean } | null;
      };
      if (body.connector?.online) return;
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

export async function installManagedConnector(
  config: InstallationConfig,
  managementSecret: string,
  options: ConnectorInstallOptions = {},
): Promise<void> {
  protectInstallationSecrets(managementSecret);
  logInstallation(`Requested Agent Connector version: ${config.connectorVersion}`);
  let phase = "Installing Agent Connections";
  const progress = (message: string) => {
    phase = message;
    logInstallation(message);
    options.onProgress?.(message);
  };
  let staged: Awaited<ReturnType<typeof stageConnectorBinary>>;
  try {
    progress("Checking Agent Connector service support");
    await checkManagedConnectorPrerequisites();
    if (process.platform === "linux") {
      progress("Configuring Agent Connector background permissions");
      await ensureUserLinger(options);
    }
    progress("Downloading Agent Connector");
    staged = await stageConnectorBinary(config.connectorVersion, progress);
  } catch (error) {
    throw new Error(`${phase}: ${installationMessage(error)}`, { cause: error });
  }
  const installDirectory = path.join(os.homedir(), ".local", "bin");
  const installPath = path.join(installDirectory, "overtchat-connector");
  const backupPath = `${installPath}.previous`;
  let hadPrevious = false;
  let installed = false;
  let payloadInUse = false;
  let promotionDirectory: string | undefined;
  try {
    progress("Checking Agent Connector executable");
    const preflight = await requireSuccessful(staged.binary, ["version"], { timeoutMs: 10_000 });
    if (preflight.stdout.trim() !== config.connectorVersion) {
      throw new Error(
        "The downloaded Agent Connector failed its version check.",
      );
    }
    await mkdir(installDirectory, { recursive: true, mode: 0o700 });
    promotionDirectory = await mkdtemp(path.join(installDirectory, ".overtchat-connector-"));
    const candidate = path.join(promotionDirectory, "overtchat-connector");
    await copyFile(staged.binary, candidate);
    await chmod(candidate, 0o755);
    try {
      await readFile(installPath);
      await rm(backupPath, { force: true });
      await copyFile(installPath, backupPath);
      hadPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Both paths are on the installation filesystem. Keep the stable command
    // intact until its complete replacement is ready.
    await rename(candidate, installPath);
    installed = true;
    payloadInUse = true;
    progress("Configuring Agent Connector connection");
    const provisioned = await provisionConnector(config, managementSecret);
    protectInstallationSecrets(provisioned.token);
    progress("Starting Agent Connector service");
    await requireSuccessful(installPath, ["install-managed"], {
      timeoutMs: 120_000,
      input: `${JSON.stringify({
        serverUrl: `http://127.0.0.1:${config.appPort}`,
        connectorId: provisioned.connectorId,
        token: provisioned.token,
      })}\n`,
    });
    progress("Waiting for Agent Connector connection");
    await waitForConnector(config, managementSecret);
    logInstallation("Agent Connector connected");
    await rm(backupPath, { force: true });
  } catch (error) {
    const failedPhase = phase;
    // Capture diagnostics before stopping the failed service or restoring a binary.
    if (installed) await captureConnectorDiagnostics();
    if (installed || hadPrevious)
      progress(hadPrevious ? "Restoring previous Agent Connector binary" : "Stopping unsuccessful Agent Connector installation");
    if (installed) {
      if (process.platform === "darwin") {
        await runCommand("launchctl", ["bootout", `gui/${process.getuid!()}/com.overtchat.connector`], { timeoutMs: 20_000 }).catch(() => null);
      } else {
        await runCommand("systemctl", ["--user", "stop", "overtchat-connector.service"], { timeoutMs: 20_000 }).catch(() => null);
      }
      if (!hadPrevious) {
        await rm(installPath, { force: true });
        payloadInUse = false;
      }
    }
    if (hadPrevious) {
      await rename(backupPath, installPath);
      payloadInUse = false;
      if (process.platform === "darwin") {
        await runCommand(installPath, ["service-install"], { timeoutMs: 120_000 }).catch(() => null);
      } else {
        await runCommand("systemctl", ["--user", "restart", "overtchat-connector.service"], { timeoutMs: 120_000 }).catch(() => null);
      }
    }
    throw new Error(`${failedPhase}: ${installationMessage(error)}`, { cause: error });
  } finally {
    await rm(staged.temporaryDirectory, { recursive: true, force: true });
    if (promotionDirectory) await rm(promotionDirectory, { recursive: true, force: true });
    if (staged.payloadDirectory && !payloadInUse) {
      await rm(staged.payloadDirectory, { recursive: true, force: true });
    }
  }
}

async function captureConnectorDiagnostics(): Promise<void> {
  try {
    const result = process.platform === "darwin"
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
