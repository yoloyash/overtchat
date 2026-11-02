import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { powershellLiteral } from "./host-environment.js";

const exec = promisify(execFile);

export async function powershell(script: string, timeout = 45_000): Promise<string> {
  const result = await exec("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';\n${script}`, "utf16le").toString("base64"),
  ], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

/** Protect the connector-owned state directory before writing credentials. */
export async function protectWindowsDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  await powershell(`$directory = New-Object IO.DirectoryInfo(${powershellLiteral(directory)})
$acl = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($rule) }
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]'S-1-5-18')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
$directory.SetAccessControl($acl)`, 15_000);
}
