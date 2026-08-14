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
import type { InstallationConfig } from "./types.js";

function connectorAsset(): string {
  if (process.platform !== "linux") {
    throw new Error("Agent Connections currently require Linux.");
  }
  if (process.arch === "x64") return "overtchat-connector-linux-amd64";
  if (process.arch === "arm64") return "overtchat-connector-linux-arm64";
  throw new Error(`Agent Connections do not support ${process.arch}.`);
}

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
): Promise<{ temporaryDirectory: string; binary: string }> {
  const override = process.env.OVERTCHAT_CONNECTOR_BINARY?.trim();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-connector-"),
  );
  const staged = path.join(temporaryDirectory, "overtchat-connector");
  if (override) {
    await copyFile(override, staged);
    await chmod(staged, 0o755);
    return { temporaryDirectory, binary: staged };
  }
  const asset = connectorAsset();
  const releaseBase = `https://github.com/${CONNECTOR_REPOSITORY}/releases/download/connector-v${version}`;
  const [binary, checksums] = await Promise.all([
    download(`${releaseBase}/${asset}`),
    download(`${releaseBase}/connector-checksums.txt`),
  ]);
  const expected = expectedChecksum(new TextDecoder().decode(checksums), asset);
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual !== expected) {
    throw new Error("The downloaded Agent Connector failed checksum verification.");
  }
  await writeFile(staged, binary, { mode: 0o755 });
  await chmod(staged, 0o755);
  return { temporaryDirectory, binary: staged };
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

async function ensureUserLinger(): Promise<void> {
  if (!(await commandExists("loginctl"))) return;
  const username = os.userInfo().username;
  const current = await runCommand("loginctl", [
    "show-user",
    username,
    "--property=Linger",
    "--value",
  ]);
  if (current.exitCode === 0 && current.stdout.trim() === "yes") return;
  const direct = await runCommand("loginctl", ["enable-linger", username]);
  if (direct.exitCode === 0) return;
  if (!(await commandExists("sudo"))) {
    throw new Error(
      "Agent Connections need user lingering enabled so they stay online after logout.",
    );
  }
  await requireSuccessful(
    "sudo",
    ["loginctl", "enable-linger", username],
    { inherit: true },
  );
}

export async function installManagedConnector(
  config: InstallationConfig,
  managementSecret: string,
): Promise<void> {
  if (process.getuid?.() === 0 && process.env.SUDO_USER) {
    throw new Error(
      "Run overtchat setup as your normal user. It will request sudo only when Docker needs it.",
    );
  }
  const systemd = await runCommand("systemctl", ["--user", "show-environment"]);
  if (systemd.exitCode !== 0) {
    throw new Error(
      "Agent Connections require a running systemd user session on this machine.",
    );
  }
  await ensureUserLinger();
  const staged = await stageConnectorBinary(config.connectorVersion);
  const installDirectory = path.join(os.homedir(), ".local", "bin");
  const installPath = path.join(installDirectory, "overtchat-connector");
  const backupPath = `${installPath}.previous`;
  let hadPrevious = false;
  try {
    const preflight = await requireSuccessful(staged.binary, ["version"]);
    if (preflight.stdout.trim() !== config.connectorVersion) {
      throw new Error(
        "The downloaded Agent Connector failed its version check.",
      );
    }
    await mkdir(installDirectory, { recursive: true, mode: 0o700 });
    try {
      await readFile(installPath);
      hadPrevious = true;
      await rm(backupPath, { force: true });
      await rename(installPath, backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await copyFile(staged.binary, installPath);
    await chmod(installPath, 0o755);
    const provisioned = await provisionConnector(config, managementSecret);
    await requireSuccessful(installPath, ["install-managed"], {
      input: `${JSON.stringify({
        serverUrl: `http://127.0.0.1:${config.appPort}`,
        connectorId: provisioned.connectorId,
        token: provisioned.token,
      })}\n`,
    });
    await waitForConnector(config, managementSecret);
    await rm(backupPath, { force: true });
  } catch (error) {
    await rm(installPath, { force: true });
    if (hadPrevious) {
      await rename(backupPath, installPath).catch(() => {});
      await runCommand("systemctl", [
        "--user",
        "restart",
        "overtchat-connector.service",
      ]).catch(() => null);
    }
    throw error;
  } finally {
    await rm(staged.temporaryDirectory, { recursive: true, force: true });
  }
}
