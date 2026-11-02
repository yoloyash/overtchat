import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertLaunchAgentAvailable, installLaunchAgent } from "./launchd.js";
import { assertWindowsServiceAvailable, installWindowsService } from "./windows-service.js";

const exec = promisify(execFile);
const execFileAsync = (command: string, args: string[]) => exec(command, args, { timeout: 30_000, killSignal: "SIGKILL" });

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function connectorInvocation(): string[] {
  // Installed launchers point at an immutable runtime directory. Keep the
  // service on the stable launcher so an atomic upgrade/rollback takes effect.
  // The Windows batch launcher does not set this: every install and rollback
  // rewrites its task, which runs the runtime without cmd.exe in between.
  const launcher = process.env.OVERTCHAT_CONNECTOR_LAUNCHER;
  if (launcher) return [path.resolve(launcher), "run"];
  const entry = process.argv[1];
  const executable = path.resolve(process.execPath);
  const command = process.platform === "win32" ? "service-run" : "run";
  if (
    path.basename(executable).startsWith("overtchat-connector") ||
    !entry ||
    entry === executable
  ) {
    return [executable, command];
  }
  return [executable, path.resolve(entry), command];
}

export async function assertUserServiceAvailable(): Promise<void> {
  if (process.platform === "win32") return assertWindowsServiceAvailable();
  if (process.platform === "darwin") return assertLaunchAgentAvailable();
  if (process.platform !== "linux") {
    throw new Error("Automatic service installation supports Linux, macOS, and Windows.");
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
  if (process.platform === "win32") return installWindowsService(connectorInvocation());
  if (process.platform === "darwin") return installLaunchAgent(connectorInvocation());
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
