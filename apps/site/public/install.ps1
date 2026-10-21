param([switch]$NoSetup)

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $cliVersion = '0.5.0'
  $asset = 'overtchat-windows-amd64.exe'
  $releaseUrl = "https://github.com/yoloyash/overtchat/releases/download/cli-v$cliVersion"
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($architecture -ne 'AMD64') { throw 'OvertChat for Windows requires an x64 PC.' }
  if ([Environment]::OSVersion.Version.Build -lt 22000) { throw 'OvertChat for Windows requires Windows 11 or newer.' }
  if (![Environment]::Is64BitProcess) { throw 'Run the installer from 64-bit PowerShell.' }
  if (!$env:LOCALAPPDATA) { throw 'Run the installer as your Windows desktop user.' }

  $directory = if ($env:OVERTCHAT_BIN_DIR) { $env:OVERTCHAT_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\OvertChat\bin' }
  $directory = [IO.Path]::GetFullPath($directory)
  $destination = Join-Path $directory 'overtchat.exe'
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.overtchat-install-' + [Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $temporary | Out-Null
  $candidate = Join-Path $temporary $asset
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host "Downloading OvertChat $cliVersion..."
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$asset" -OutFile $candidate
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/overtchat-checksums.txt").Content
    $pattern = '(?m)^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($asset) + '\s*$'
    $match = [regex]::Match([string]$checksums, $pattern)
    if (!$match.Success) { throw "The release checksum for $asset is missing." }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    if ($actual -ne $match.Groups[1].Value) { throw 'The downloaded OvertChat binary failed checksum verification.' }
    $version = (& $candidate version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne $cliVersion) { throw 'The downloaded OvertChat binary failed its startup check.' }

    # The verified manager owns locking and durable replacement/recovery. It
    # can restore an interrupted self-update even if overtchat.exe is missing.
    $oldBinOverride = $env:OVERTCHAT_BIN_DIR
    try {
      $env:OVERTCHAT_BIN_DIR = $directory
      & $candidate install-manager
      if ($LASTEXITCODE -ne 0) { throw 'Manager installation failed. Preserve the installation directory and rerun this installer to recover.' }
    } finally { $env:OVERTCHAT_BIN_DIR = $oldBinOverride }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if (!($entries | Where-Object { $_.TrimEnd('\') -ieq $directory.TrimEnd('\') })) {
      [Environment]::SetEnvironmentVariable('Path', (($entries + $directory) -join ';'), 'User')
    }
    if (!(($env:PATH -split ';') | Where-Object { $_.TrimEnd('\') -ieq $directory.TrimEnd('\') })) {
      $env:PATH = $directory + ';' + $env:PATH
    }
    Write-Host "Installed the overtchat command at $destination"
    Write-Host 'Open a new terminal to use overtchat from any shell.'
  } finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
  }
  if (!$NoSetup -and ![Console]::IsInputRedirected) {
    & $destination setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Run overtchat setup to retry.' }
  } else { Write-Host 'Run overtchat setup in an interactive terminal to finish.' }
}
