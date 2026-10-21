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
    [pscustomobject]@{Content="$hash  overtchat-windows-amd64.exe`n"}
  } else { throw "Unexpected asset: $Uri" }
}

try {
  $env:OVERTCHAT_BIN_DIR=Join-Path $root 'bin with spaces'
  & $Installer -NoSetup
  $installed=Join-Path $env:OVERTCHAT_BIN_DIR 'overtchat.exe'
  if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Installed bytes differ' }
  if (!(($env:PATH -split ';') -contains $env:OVERTCHAT_BIN_DIR)) { throw 'Current PATH was not updated' }
  & $Installer -NoSetup
  $entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -eq $env:OVERTCHAT_BIN_DIR })
  if ($entries.Count -ne 1) { throw 'Repeated installation duplicated PATH' }
  $corrupt=$true
  $rejected=$false
  try { & $Installer -NoSetup } catch { $rejected=$_.Exception.Message -like '*checksum verification*' }
  if (!$rejected) { throw 'Installer accepted a checksum mismatch' }
  if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $fixtureHash) { throw 'Failed download damaged the installed executable' }
  Write-Output 'PASS: Windows installer verifies bytes, installs in paths with spaces, preserves PATH, reinstalls, and rejects tampering without replacing the previous binary.'
} finally {
  [Environment]::SetEnvironmentVariable('Path',$oldUserPath,'User')
  $env:PATH=$oldPath
  $env:OVERTCHAT_BIN_DIR=$oldBin
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
