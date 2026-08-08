import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function connectorInvocation(): string[] {
  const entry = process.argv[1];
  const executable = path.resolve(process.execPath);
  if (
    path.basename(executable).startsWith("overtchat-connector") ||
    !entry ||
    entry === executable
  ) {
    return [executable, "run"];
  }
  return [executable, path.resolve(entry), "run"];
}

export async function assertUserServiceAvailable(): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("Automatic service installation currently supports Linux.");
  }
  try {
    await execFileAsync("systemctl", ["--user", "show-environment"]);
  } catch {
    throw new Error(
      "A running systemd user session is required to install the Host Connector.",
    );
  }
}

export async function installUserService(): Promise<string> {
  await assertUserServiceAvailable();
  const directory = path.join(os.homedir(), ".config", "systemd", "user");
  const unitPath = path.join(directory, "overtchat-connector.service");
  const invocation = connectorInvocation().map(systemdQuote).join(" ");
  const unit = `[Unit]
Description=OvertChat Host Connector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${invocation}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
  await mkdir(directory, { recursive: true });
  await writeFile(unitPath, unit, { encoding: "utf8", mode: 0o600 });
  await chmod(unitPath, 0o600);
  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", [
    "--user",
    "enable",
    "overtchat-connector.service",
  ]);
  await execFileAsync("systemctl", [
    "--user",
    "restart",
    "overtchat-connector.service",
  ]);
  return unitPath;
}
