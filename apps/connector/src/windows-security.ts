import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Protect the connector-owned state directory before writing credentials. */
export async function protectWindowsDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  const script = `$ErrorActionPreference='Stop'
$directory = New-Object IO.DirectoryInfo('${directory.replaceAll("'", "''")}')
$acl = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($rule in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($rule) }
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]'S-1-5-18')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
$directory.SetAccessControl($acl)`;
  await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true, timeout: 15_000,
  });
}
