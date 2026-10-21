param([Parameter(Mandatory=$true)][string]$Binary)
$ErrorActionPreference='Stop'
$Binary=(Resolve-Path -LiteralPath $Binary).Path
$root=Join-Path $env:TEMP ('OvertChat log follow '+[Guid]::NewGuid().ToString())
$oldConfig=$env:OVERTCHAT_CONNECTOR_CONFIG
$child=$null
try {
  $env:OVERTCHAT_CONNECTOR_CONFIG=Join-Path $root 'connector.json'
  $logs=Join-Path $root 'windows-service'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $stdout=Join-Path $logs 'connector.log'
  $stderr=Join-Path $logs 'connector.error.log'
  [IO.File]::WriteAllText($stdout, "initial stdout`n")
  [IO.File]::WriteAllText($stderr, "initial stderr`n")
  $captured=Join-Path $root 'follow.txt'
  $child=Start-Process -FilePath $Binary -ArgumentList @('logs','connector','--follow','--tail','1') -RedirectStandardOutput $captured -RedirectStandardError (Join-Path $root 'errors.txt') -WindowStyle Hidden -PassThru
  $deadline=(Get-Date).AddSeconds(20)
  while((Get-Date) -lt $deadline) {
    if($child.HasExited){throw 'Log follower exited unexpectedly'}
    $text=Get-Content -LiteralPath $captured -Raw -ErrorAction SilentlyContinue
    if($text -match 'initial stdout' -and $text -match 'initial stderr'){break}
    Start-Sleep -Milliseconds 250
  }
  if($text -notmatch 'initial stdout' -or $text -notmatch 'initial stderr'){throw 'Follower did not tail both files'}
  [IO.File]::AppendAllText($stdout,"FOLLOW_STDOUT_OK`n")
  [IO.File]::AppendAllText($stderr,"FOLLOW_STDERR_OK`n")
  $deadline=(Get-Date).AddSeconds(10)
  while((Get-Date) -lt $deadline) {
    $text=Get-Content -LiteralPath $captured -Raw
    if($text -match 'FOLLOW_STDOUT_OK' -and $text -match 'FOLLOW_STDERR_OK'){break}
    Start-Sleep -Milliseconds 250
  }
  if($text -notmatch 'FOLLOW_STDOUT_OK' -or $text -notmatch 'FOLLOW_STDERR_OK'){throw 'Follower missed output from one of the streams'}
  Write-Output 'PASS: native CLI tails and follows both connector log streams.'
} finally {
  if($child -and !$child.HasExited) { & taskkill.exe /PID $child.Id /T /F | Out-Null }
  $env:OVERTCHAT_CONNECTOR_CONFIG=$oldConfig
  if(Test-Path $root){Remove-Item $root -Recurse -Force}
}
