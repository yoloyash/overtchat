param([Parameter(Mandatory=$true)][string]$Package)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Package = (Resolve-Path -LiteralPath $Package).Path
$root = Join-Path $env:TEMP ('OvertChat service ' + [Guid]::NewGuid().ToString())
$runtime = Join-Path $root 'package\overtchat-connector\bin\node.exe'
$entry = Join-Path $root 'package\overtchat-connector\app\connector.mjs'
$oldConfig = $env:OVERTCHAT_CONNECTOR_CONFIG
$oldState = $env:OVERTCHAT_CONNECTOR_STATE
$oldTimelines = $env:OVERTCHAT_CONNECTOR_TIMELINES
$oldLock = $env:OVERTCHAT_CONNECTOR_LOCK

function Invoke-Connector([string]$Command) {
  & $runtime $entry $Command
  if ($LASTEXITCODE -ne 0) { throw "Connector $Command failed ($LASTEXITCODE)" }
}
function Wait-Running {
  $deadline = (Get-Date).AddSeconds(25)
  while (!(Test-Path -LiteralPath $running) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (!(Test-Path -LiteralPath $running)) {
    Get-Content -LiteralPath (Join-Path $root 'windows-service\connector.error.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'Connector did not start'
  }
}

try {
  New-Item -ItemType Directory -Path (Join-Path $root 'package') | Out-Null
  & (Join-Path $env:SystemRoot 'System32\tar.exe') -xzf $Package -C (Join-Path $root 'package')
  if ($LASTEXITCODE -ne 0) { throw 'Connector package extraction failed' }
  $env:OVERTCHAT_CONNECTOR_CONFIG = Join-Path $root 'connector.json'
  $env:OVERTCHAT_CONNECTOR_STATE = $null
  $env:OVERTCHAT_CONNECTOR_TIMELINES = $null
  $env:OVERTCHAT_CONNECTOR_LOCK = $null
  $running = Join-Path $root 'windows-service\running.json'
  $logs = Join-Path $root 'windows-service'
  New-Item -ItemType Directory -Path $logs | Out-Null
  [IO.File]::WriteAllText((Join-Path $logs 'connector.log'), ('x' * (11 * 1024 * 1024)))
  # No real credentials or model requests. The connector retries an unused
  # loopback endpoint while the test exercises its real journal and lifecycle.
  @{serverUrl='http://127.0.0.1:49991';connectorId='windows_fixture';token='oct_windows_fixture.disposable-test-only'} |
    ConvertTo-Json -Compress | & $runtime $entry install-managed
  if ($LASTEXITCODE -ne 0) { throw 'Connector installation failed' }
  Wait-Running
  if ((Get-Item (Join-Path $logs 'connector.log')).Length -gt 10 * 1024 * 1024 -or !(Test-Path (Join-Path $logs 'connector.log.1'))) {
    throw 'Packaged connector failed to rotate an oversized log'
  }
  $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
  foreach ($file in @($env:OVERTCHAT_CONNECTOR_CONFIG, (Join-Path $root 'windows-service\connector.ps1'))) {
    $rules = (Get-Acl -LiteralPath $file).Access
    if (@($rules).Count -ne 2) { throw 'Expected only the user and SYSTEM to access connector credentials/launcher' }
    foreach ($rule in $rules) {
      if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
        throw 'Unexpected access to connector credentials/launcher'
      }
    }
  }
  $crashed = Get-Content -LiteralPath $running -Raw | ConvertFrom-Json
  # Task Scheduler does not restart an action that exits with an error; the
  # launcher must. A forced kill leaves the stale marker until the restart.
  Stop-Process -Id $crashed.pid -Force
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $first = Get-Content -LiteralPath $running -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  } while ((!$first -or $first.nonce -eq $crashed.nonce) -and (Get-Date) -lt $deadline)
  if (!$first -or $first.nonce -eq $crashed.nonce) { throw 'Connector did not restart after a crash' }
  $task = Get-ScheduledTask | Where-Object { $_.Actions.Arguments -like ('*' + $root + '*') }
  if (@($task).Count -ne 1) { throw 'Expected exactly one task for the isolated connector' }
  if ($task.Principal.RunLevel -ne 0 -or $task.Principal.LogonType -ne 3) { throw 'Task must use a non-elevated interactive user token' }
  Invoke-Connector 'service-stop'
  if (Test-Path -LiteralPath $running) { throw 'Graceful stop left the running marker' }
  if (Test-Path -LiteralPath (Join-Path $root 'connector-windows_fixture.lock')) { throw 'Graceful stop left the journal lock' }
  Invoke-Connector 'preflight'
  Invoke-Connector 'service-install'
  Wait-Running
  $second = Get-Content -LiteralPath $running -Raw | ConvertFrom-Json
  if ($first.nonce -eq $second.nonce) { throw 'Restart reused the old instance' }
  Invoke-Connector 'service-uninstall'
  if (Get-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue) { throw 'Uninstall left the scheduled task' }
  if (!(Test-Path -LiteralPath $env:OVERTCHAT_CONNECTOR_CONFIG)) { throw 'Service uninstall removed credentials' }
  Write-Output 'PASS: Windows connector install/start/crash-restart/graceful-stop/journal-reopen/restart/uninstall; limited interactive identity; paths with spaces.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $root 'windows-service')) {
    & $runtime $entry service-uninstall
    if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath $root -Recurse -Force }
  }
  $env:OVERTCHAT_CONNECTOR_CONFIG = $oldConfig
  $env:OVERTCHAT_CONNECTOR_STATE = $oldState
  $env:OVERTCHAT_CONNECTOR_TIMELINES = $oldTimelines
  $env:OVERTCHAT_CONNECTOR_LOCK = $oldLock
}
