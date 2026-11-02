import type {
  AgentProcess,
  AgentProcessHostLaunch,
  HostTarget,
} from "@overtchat/agent-runtime";
import {
  powershellCommand,
  powershellLiteral,
  runHostControl,
} from "./host-environment.js";

export type WindowsProcessBackend = {
  isWindows(target: HostTarget, signal?: AbortSignal): Promise<boolean>;
  spawnGate(
    target: HostTarget,
    launch: AgentProcessHostLaunch,
    id: string,
  ): Promise<AgentProcess>;
};

export async function windowsProcessTable(
  target: HostTarget,
  signal?: AbortSignal,
) {
  const output = await runHostControl(
    target,
    powershellCommand(`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
  if ($_.CreationDate) {
    @{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;pgid=0;state='R';started=$_.CreationDate.ToUniversalTime().ToString('o');command=[string]$_.CommandLine}
  }
})
ConvertTo-Json -InputObject $rows -Compress
`),
    signal,
  );
  const rows: unknown = JSON.parse(output);
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (row) =>
        row &&
        Number.isInteger(row.pid) &&
        Number.isInteger(row.ppid) &&
        typeof row.started === "string" &&
        typeof row.command === "string",
    )
  )
    throw new Error("Invalid Windows process table.");
  return rows as Array<{
    pid: number;
    ppid: number;
    pgid: number;
    state: string;
    started: string;
    command: string;
  }>;
}

export async function stopWindowsProcesses(
  target: HostTarget,
  rows: Array<{ pid: number; started: string }>,
  signal?: AbortSignal,
): Promise<void> {
  // Recheck identity on the execution host immediately before terminating.
  // A PID reused since the table snapshot must never authorize a kill.
  const script = rows
    .map((row) => {
      if (!Number.isSafeInteger(row.pid) || row.pid <= 1)
        throw new Error("Invalid Windows process ID.");
      return `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${row.pid}'; if ($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq ${powershellLiteral(row.started)}) { & taskkill.exe /PID ${row.pid} /T /F 2>$null | Out-Null }`;
    })
    .join("\n");
  // Bound command length even when a provider owns a large process tree.
  if (rows.length > 8) {
    for (let i = 0; i < rows.length; i += 8)
      await stopWindowsProcesses(target, rows.slice(i, i + 8), signal);
    return;
  }
  await runHostControl(
    target,
    powershellCommand(
      `$ErrorActionPreference='Continue'; $ProgressPreference='SilentlyContinue'\n${script}\nexit 0`,
    ),
    signal,
  );
}
