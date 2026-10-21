import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { connectorConfigPath } from "./config.js";
import { protectWindowsDirectory } from "./windows-security.js";

const exec = promisify(execFile);
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function windowsServiceDirectory(): string {
  return path.join(path.dirname(connectorConfigPath()), "windows-service");
}

export function windowsTaskName(): string {
  const identity = path.resolve(connectorConfigPath()).toLowerCase();
  return `OvertChat Connector ${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

async function powershell(script: string): Promise<string> {
  const result = await exec("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';\n${script}`, "utf16le").toString("base64"),
  ], { windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

const scheduler = `$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\\')`;

export async function assertWindowsServiceAvailable(): Promise<void> {
  await powershell(`${scheduler}
if ((Get-Service Schedule).Status -ne 'Running') { throw 'Windows Task Scheduler is not running.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($sid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'Run setup as your desktop user, not a system service account.' }`);
}

export function windowsServiceLauncher(invocation: string[], environment: NodeJS.ProcessEnv): string {
  const variables = [
    "OVERTCHAT_CONNECTOR_CONFIG", "OVERTCHAT_CONNECTOR_STATE",
    "OVERTCHAT_CONNECTOR_TIMELINES", "OVERTCHAT_CONNECTOR_LOCK",
    "OVERTCHAT_SSH_NODE_PATHS",
  ].filter((key) => environment[key]).map((key) => `$env:${key} = ${literal(environment[key]!)}`);
  return `$ErrorActionPreference = 'Stop'
${variables.join("\n")}
# Read current user/machine paths at every login; retain custom launch paths too.
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + ${literal(environment.PATH || environment.Path || "")}
Set-Location -LiteralPath ${literal(os.homedir())}
& ${invocation.map(literal).join(" ")}
exit $LASTEXITCODE
`;
}

async function taskExists(): Promise<boolean> {
  return (await powershell(`${scheduler}
try { $null = $folder.GetTask(${literal(windowsTaskName())}); 'yes' }
catch { if ($_.Exception.HResult -eq -2147024894) { 'no' } else { throw } }`)) === "yes";
}

export async function stopWindowsService(): Promise<void> {
  if (!(await taskExists())) return;
  // Disable before requesting shutdown: Task Scheduler must not race an update
  // by restarting the old executable or triggering it at another login.
  await powershell(`${scheduler}
$task = $folder.GetTask(${literal(windowsTaskName())})
$task.Enabled = $false`);
  const directory = windowsServiceDirectory();
  const running = path.join(directory, "running.json");
  const request = path.join(directory, "stop.json");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const raw = await readFile(running, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw) {
      const state = JSON.parse(raw) as { nonce: string };
      await writeFile(request, JSON.stringify({ nonce: state.nonce }), { mode: 0o600 });
    }
    const state = await powershell(`${scheduler}
[int]$folder.GetTask(${literal(windowsTaskName())}).State`);
    if (state !== "4" && state !== "2") return; // running / queued
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The Windows Host Connector did not stop within 30 seconds. Its task remains disabled; inspect overtchat logs connector before retrying. The installed binary was not replaced.");
}

export async function installWindowsService(invocation: string[]): Promise<string> {
  await assertWindowsServiceAvailable();
  await stopWindowsService();
  const directory = windowsServiceDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await protectWindowsDirectory(directory);
  const launcher = path.join(directory, "connector.ps1");
  await writeFile(launcher, windowsServiceLauncher(invocation, process.env), { mode: 0o600 });
  // InteractiveToken + LeastPrivilege intentionally matches the logged-in-user
  // model on macOS. No stored password, SYSTEM identity, or elevated agents.
  await powershell(`${scheduler}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$definition = $scheduler.NewTask(0)
$definition.RegistrationInfo.Description = 'OvertChat Host Connector for the signed-in user'
$definition.Principal.UserId = $sid
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0
$trigger = $definition.Triggers.Create(9)
$trigger.UserId = $sid
$trigger.Delay = 'PT5S'
$definition.Settings.Enabled = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.ExecutionTimeLimit = 'PT0S'
$definition.Settings.MultipleInstances = 2
$definition.Settings.RestartInterval = 'PT1M'
$definition.Settings.RestartCount = 999
$action = $definition.Actions.Create(0)
$action.Path = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$action.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + ${literal(launcher)} + '"'
$action.WorkingDirectory = ${literal(os.homedir())}
$task = $folder.RegisterTaskDefinition(${literal(windowsTaskName())}, $definition, 6, $sid, $null, 3)
$null = $task.Run($null)`);
  return launcher;
}

export async function uninstallWindowsService(): Promise<void> {
  await stopWindowsService();
  if (await taskExists()) await powershell(`${scheduler}
$folder.DeleteTask(${literal(windowsTaskName())}, 0)`);
  // Keep the connector journal and credentials. Uninstall only owns the task.
}

/** Local, per-run stop requests avoid Windows' forceful emulation of SIGTERM. */
export async function watchWindowsServiceStop(stop: () => Promise<void>): Promise<() => Promise<void>> {
  const directory = windowsServiceDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const running = path.join(directory, "running.json");
  const nonce = randomUUID();
  const temporary = `${running}.${nonce}`;
  await writeFile(temporary, JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600 });
  await rename(temporary, running);
  let pending = false;
  const timer = setInterval(() => {
    if (pending) return;
    pending = true;
    void (async () => {
      const request = await readFile(path.join(directory, "stop.json"), "utf8").catch(() => "");
      let matches = false;
      try { matches = (JSON.parse(request) as { nonce?: string }).nonce === nonce; } catch { /* incomplete write */ }
      if (matches) { clearInterval(timer); await stop(); }
    })().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { pending = false; });
  }, 250);
  timer.unref();
  return async () => {
    clearInterval(timer);
    const state = await readFile(running, "utf8").catch(() => "");
    if (state && (JSON.parse(state) as { nonce?: string }).nonce === nonce) await rm(running, { force: true });
  };
}
