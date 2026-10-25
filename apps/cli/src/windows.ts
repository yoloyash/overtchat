import { requireSuccessful, runCommand, type RunOptions } from "./process.js";

export const powershellLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export function powershellArgs(script: string): string[] {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';\n${script}`, "utf16le").toString("base64")];
}

export async function runPowerShell(script: string, options: RunOptions = {}) {
  return runCommand("powershell.exe", powershellArgs(script), { timeoutMs: 30_000, ...options });
}

export async function windowsLogTail(files: string[], tail: number, follow = false): Promise<void> {
  const paths = `@(${files.map(powershellLiteral).join(",")})`;
  // Get-Content -Wait processes paths sequentially and would never reach the
  // error log. Follow each file in its own job and drain both streams.
  const script = follow && files.length > 1 ? `
$jobs = @()
try {
  foreach ($file in ${paths}) {
    $jobs += Start-Job -ArgumentList $file, ${tail} -ScriptBlock {
      param($file, $tail)
      Get-Content -LiteralPath $file -Tail $tail -Wait -ErrorAction Stop
    }
  }
  while ($true) {
    $jobs | Receive-Job -ErrorAction Stop
    if (@($jobs | Where-Object State -eq 'Running').Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
} finally {
  $jobs | Stop-Job
  $jobs | Remove-Job -Force
}` : `Get-Content -LiteralPath ${paths} -Tail ${tail}${follow ? " -Wait" : ""}`;
  await requireSuccessful("powershell.exe", powershellArgs(script), { inherit: true });
}

/** Call only on OvertChat-owned directories, before writing credentials. */
export async function protectWindowsDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  await requireSuccessful("powershell.exe", powershellArgs(`
$directory = New-Object IO.DirectoryInfo(${powershellLiteral(directory)})
$acl = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($rule) }
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]'S-1-5-18')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
$directory.SetAccessControl($acl)`), { timeoutMs: 15_000 });
}
