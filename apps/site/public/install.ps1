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
  $backup = $destination + '.previous-' + [Guid]::NewGuid().ToString()
  $moved = $false
  $removeBackup = $false
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

    $replace = $true
    if (Test-Path -LiteralPath $destination) {
      $installed = (& $destination version | Out-String).Trim()
      if ($LASTEXITCODE -eq 0 -and $installed -match '^\d+\.\d+\.\d+$' -and [version]$installed -gt [version]$cliVersion) {
        Write-Host "Keeping the newer installed OvertChat $installed."
        $replace = $false
      }
    }
    if ($replace) {
      if (Test-Path -LiteralPath $destination) {
        Move-Item -LiteralPath $destination -Destination $backup
        $moved = $true
      }
      try { Move-Item -LiteralPath $candidate -Destination $destination; $removeBackup = $true }
      catch {
        if ($moved) { Move-Item -LiteralPath $backup -Destination $destination; $removeBackup = $true }
        throw
      }
    }

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
    # A running older CLI can keep its renamed image locked until it exits.
    if ($removeBackup -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
  }
  if (!$NoSetup -and ![Console]::IsInputRedirected) {
    & $destination setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Run overtchat setup to retry.' }
  } else { Write-Host 'Run overtchat setup in an interactive terminal to finish.' }
}
