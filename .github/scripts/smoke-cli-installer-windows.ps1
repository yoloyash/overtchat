param(
  [Parameter(Mandatory=$true)][string]$Binary,
  [Parameter(Mandatory=$true)][string]$Installer
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Binary=(Resolve-Path -LiteralPath $Binary).Path
$Installer=(Resolve-Path -LiteralPath $Installer).Path
$root=Join-Path $env:TEMP ('OvertChat installer ' + [Guid]::NewGuid().ToString())
$oldBin=$env:OVERTCHAT_BIN_DIR
$oldPath=$env:PATH
$oldUserPath=[Environment]::GetEnvironmentVariable('Path','User')
$fixtureHash=(Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash
$corrupt=$false

# Exercise the real installer with verified fixture bytes, without publishing
# a release or changing the user's Docker installation.
function Invoke-WebRequest {
  param([switch]$UseBasicParsing,[string]$Uri,[string]$OutFile)
  if ($Uri -notmatch '^https://github.com/yoloyash/overtchat/releases/download/cli-v\d+\.\d+\.\d+/') { throw "Unexpected download: $Uri" }
  if ($Uri.EndsWith('/overtchat-windows-amd64.exe')) {
    Copy-Item -LiteralPath $Binary -Destination $OutFile
  } elseif ($Uri.EndsWith('/overtchat-checksums.txt')) {
    $hash=if ($corrupt) { '0'*64 } else { $fixtureHash }
    $bytes=[Text.Encoding]::UTF8.GetBytes("$hash  overtchat-windows-amd64.exe`n")
    # GitHub serves application/octet-stream, which Windows PowerShell 5.1
    # returns as a byte array; mirror that so text-only parsing fails here.
    if ($OutFile) { [IO.File]::WriteAllBytes($OutFile, $bytes) } else { [pscustomobject]@{Content=$bytes} }
  } else { throw "Unexpected asset: $Uri" }
}

try {
  $env:OVERTCHAT_BIN_DIR=Join-Path $root 'bin with spaces'
  & $Installer -NoSetup
  $installed=Join-Path $env:OVERTCHAT_BIN_DIR 'overtchat.exe'
  # Windows PowerShell expands short (8.3) directory names in GetFullPath.
  # Hosted runners can supply TEMP using that short form; compare the
  # canonical installation directory that the installer adds to PATH.
  $expectedBin=[IO.Path]::GetFullPath($env:OVERTCHAT_BIN_DIR)
  if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Installed bytes differ' }
  if (!(($env:PATH -split ';') -contains $expectedBin)) { throw 'Current PATH was not updated' }
  & $Installer -NoSetup
  $entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -eq $expectedBin })
  if ($entries.Count -ne 1) { throw 'Repeated installation duplicated PATH' }
  $corrupt=$true
  $rejected=$false
  try { & $Installer -NoSetup } catch { $rejected=$_.Exception.Message -like '*checksum verification*' }
  if (!$rejected) { throw 'Installer accepted a checksum mismatch' }
  if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Failed download damaged the installed executable' }
  $corrupt=$false
  # Reproduce termination between the two Windows executable renames. The
  # bootstrap must recover without depending on a working installed command.
  [IO.File]::WriteAllText($installed+'.update.json', '{"format":1,"previous":true,"committed":false}')
  Move-Item -LiteralPath $installed -Destination ($installed+'.previous')
  & $Installer -NoSetup
  if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Installer did not recover the missing entry point' }
  if (Test-Path -LiteralPath ($installed+'.update.json')) { throw 'Recovery did not finish its journal' }
  $lock=Join-Path $env:OVERTCHAT_BIN_DIR '.management.lock'
  [IO.File]::WriteAllText($lock, (@{pid=$PID;startedAt=[DateTime]::UtcNow.ToString('o');ownerId=[Guid]::NewGuid().ToString()}|ConvertTo-Json -Compress))
  try {
    $rejected=$false
    try { & $Installer -NoSetup } catch { $rejected=$true }
    if (!$rejected) { throw 'Installer ignored a concurrent management operation' }
    if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Concurrent attempt changed the executable' }
  } finally { Remove-Item -LiteralPath $lock -Force }
  Write-Output 'PASS: Windows installer verifies bytes, preserves PATH, rejects tampering/concurrent updates, and recovers a missing CLI entry point.'
  # The rejected competing operation intentionally exits 1. GitHub's PowerShell
  # wrapper propagates LASTEXITCODE, so clear that expected failure only after
  # all assertions pass. Unexpected errors still terminate the script.
  $global:LASTEXITCODE=0
} finally {
  [Environment]::SetEnvironmentVariable('Path',$oldUserPath,'User')
  $env:PATH=$oldPath
  $env:OVERTCHAT_BIN_DIR=$oldBin
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
