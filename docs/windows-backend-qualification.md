# Windows backend qualification — 2026-10-21

Implementation is in the working checkout. Nothing has been published. The
candidate manifest selects CLI **0.5.0** and connector **0.15.0**; promotion waits
for both matching Windows artifacts before exposing Windows setup instructions.
The existing app image remains **0.27.0**, with no Windows-specific web changes.

Deployment and operator instructions: [Deploy](deploy.md#windows).
Release procedure: [Windows qualification](release.md#windows-backend-qualification).

## Environment

- Physical `gaming-pc`: Windows 11 x64, build 26300, RTX 3090 Ti, NTFS.
- Docker Desktop Linux engine 29.9.1, Compose 5.6.0, WSL 2.
- Native CLI compiled with release-pinned Bun 1.4.2; connector with Bun 1.3.14.
- Source tests use Node 22.19.0 and npm 10.9.8 on both Mac and Windows.
- Setup/update run through the signed-in user's limited interactive token,
  without administrator privileges. PowerShell 5.1 is exercised.
- Isolated paths include spaces. Existing agent credentials and SSH configuration
  are used in place, without copying them into Docker or the connector launcher.

## Verified on the PC

| Check | Result |
| --- | --- |
| Native installer | SHA-256/startup verification, installation in a spaced path, user PATH, repeat installation, rejection of corrupted bytes without replacing the installed executable |
| Native self-update | Production updater replaces its own running `.exe`, retains its recovery image, and starts the replacement; corrupt download rejected |
| Managed setup | Linux app, Redis, SearXNG, speech containers; app readiness and managed connector provisioning |
| Permissions | Config secrets, connector token, and task launcher accessible only to the user and SYSTEM |
| Connector lifecycle | Least-privilege interactive Task Scheduler identity; start, graceful stop, lock release, journal reopen, restart, task uninstall retaining data |
| Connector logs | Packaged oversized-log rotation; both stdout and stderr followed by the native manager |
| Real local agent | OMP 18.12.2 discovered; model catalog loaded; real model request wrote a file in an isolated Windows workspace |
| Real SSH agent | Windows connector used `home-server-2` from the Windows SSH config; OMP 18.11.1 wrote a file in an isolated remote workspace |
| Browser | Chromium on a separate Mac over LAN: initial account creation, login, both agent conversations rendered; no page errors |
| CPU speech | Authenticated app request returned audio bytes with an audio content type |
| NVIDIA speech | Container GPU probe by UUID and authenticated Kokoro CUDA speech generation on the 3090 Ti |
| Managed update | CLI 0.5.0/connector 0.15.0 candidate; graceful connector replacement; account, instance identity, and both conversations retained |
| Docker restart | Docker Desktop stopped and started; containers and connector connection recovered with data retained |
| Windows reboot | Actual boot time changed; Docker Desktop and connector started after sign-in without manually starting either service; LAN app returned |
| Agent resume after reboot | Both original sessions resumed, read their files, and completed new model replies; two successful tool calls per session |
| Journal durability | Packaged SQLite migration/backup/reopen; eight forced-kill transaction boundaries; three interrupted migrations recovered |
| Large journal | 610 MB input; migration/replay/restart/compaction completed; no orphan temporary files; peak RSS about 301 MiB |

The native installer smoke substitutes download transport with the locally built
candidate bytes and exercises the actual installer. The native updater smoke
substitutes download transport and a versioned replacement fixture while running
the actual updater inside the executable being replaced. Neither requires
publishing an unreleased artifact.

## Automated checks

- Mac: CLI 263 tests, connector 184 tests, bridge 72 tests, site 33 tests passed.
  Connector's 24 opt-in integration tests were skipped by the ordinary suite;
  physical native/SSH tests above are separate evidence.
- Windows: 32 focused CLI tests and 64 connector tests passed, including native
  helper quoting, binary stdin, ownership gating, input liveness, log rotation,
  journal persistence, and client reconnection.
- CLI/connector/bridge/site typechecks, relevant lint, CLI/connector builds,
  and site static export passed.
- Promotion readiness: 25 tests passed. Modified workflow YAML parsed and
  `git diff --check` passed.
- Static Windows setup page checked at desktop and 390px mobile widths.
- Apple speech bundle source matches; gzip OS header normalized so the existing
  generated artifact verifies on Mac and Windows as well as Linux.
- Full root test suite passed after updating the web connector-version fixtures.
  The installer smoke also passed with both long and Windows 8.3 temporary paths;
  its PATH assertions compare the installer's canonical directory.

## Update recovery hardening — 2026-10-21

The update audit found gaps beyond the earlier partial-copy fix. The manager now
reuses saved pairing credentials, writes connector configuration atomically,
serializes installation changes, and journals executable replacement before
stopping/replacing services. Recovery checks restart exit status and authenticated
readiness for the expected connector identity/version. Noninteractive partial
setup/update failure persists pending state and exits nonzero.

Local checks: CLI 277 tests and connector 187 tests passed, plus workspace
lint/typecheck/build. Windows checks on `gaming-pc` used locally compiled candidate
binaries with the release-pinned runtimes:

- CLI SHA-256: `0821ef0953a8fbb31c58d44e8baea62bf9e1abdb3feff7630e694f0f659b06fd`.
- Connector SHA-256: `9be72ffce8672f0d0fa7aef204e3d9258ce9dc1333bfd86571aeb8fc60958d16`.
- Seven Windows updater/recovery tests passed, including four actual child-process
  kills at prepared, backup, replacement, and committed boundaries. Two Darwin
  filesystem tests run on Mac rather than pretending NTFS supports directory fsync.
- Three real-file configuration tests preserved the old pairing on partial write,
  fsync, and rename failures, then succeeded on retry.
- The compiled CLI replaced its own running image. Bun 1.4.2 returns `EFAULT`
  when deleting a mapped Windows executable; committed backup cleanup now defers
  that case until a subsequent setup/update, keeping its journal.
- The real PowerShell installer passed repeat install, spaces/PATH, tamper
  rejection, competing-manager rejection, and recovery with `overtchat.exe`
  missing between replacement renames.
- The real scheduled-task rollback smoke preserved a running old connector when
  staging failed and restored/restarted it after invalid startup configuration.
  Its management readiness is a fixture; its executable, NTFS, and task are real.
- Separately, a production connector update against the actual managed backend
  preserved the pairing token and ID, matched the candidate bytes, and returned
  authenticated online status at the expected version.
- The full compiled CLI ran in a limited interactive task. A competing connector
  lock produced exit 1 with pending state persisted; retry produced exit 0,
  cleared pending state, and preserved credentials. The temporary task was removed.
- GitHub Actions artifacts downloaded from `1f25f29` matched both candidate hashes
  above exactly; installed binaries were checked against them on the PC.

These checks cover process termination and reported filesystem errors, not a
physical power-cut durability guarantee or rollback of database migrations.
The preceding day's artifact hashes below describe the earlier implementation;
current-head CI artifact verification is tracked separately on the PR.

## Earlier qualification — 2026-10-20

Follow-up rollback audit: a failed Windows connector copy could leave a partial
executable that the recovery path attempted to run, preventing restoration of the
previous binary. The earlier fix skipped replacement shutdown until service startup
had been attempted; the current implementation stages complete bytes before
stopping the old service. If a started replacement cannot stop, the error preserves
both failures and identifies the retained backup. The CLI suite passes 265 tests,
including simulated partial-copy failure and failed-shutdown recovery; CLI lint,
typecheck, and build also pass.

Follow-up physical qualification used the downloaded GitHub Actions artifacts
from commit `c999de5`, with hashes checked again on the Windows PC:

- CLI: `cd93201443079717753581f256b5f0499bdec4f11dae26e6e7337a3b38f4e523`.
- Connector: `d64fb238f6646eff8074a87d2a32766c085cf0f56d4a982c033a4fd9d8eaaebd`.
- The real PowerShell installer passed against the CI CLI artifact, and that
  artifact completed managed update through a limited interactive task.
- The checked-in rollback smoke used the CI connector, real NTFS operations,
  and real scheduled tasks. Injected partial-copy and provisioning failures
  restored the original executable and credentials and restarted the task. The
  partial-copy check failed against the pre-fix source, confirming regression
  coverage. Download/provisioning fault injection is not public-release testing.
- The CI connector passed install/start/graceful-stop/journal-reopen/restart/
  uninstall and oversized-log rotation under its expected executable name.
- All 64 Windows connector tests passed with file parallelism disabled. Hosted
  CI had timed out in journal migration and native PowerShell helper startup;
  the workflow now serializes these integration suites without raising their
  timeouts or removing assertions. Final hosted status is on the PR.
- Managed GPU Parakeet STT and realtime voice images were provisioned on the
  3090 Ti. Authenticated multipart transcription passed. The shared voice client
  sent generated PCM over the app's WebSocket route: real GPU STT, the real LAN
  vLLM model, and GPU Kokoro returned 89,088 PCM bytes and persisted both turns.
  This validates backend transport and speech, not a physical microphone/speaker.
  An initial test requested an unsupported reasoning setting; the model's default
  setting passed. No product change was needed for that test error.
- Authenticated access passed through the Windows Tailscale address and through
  private Tailscale Serve HTTPS on port 443, including TLS certificate validation.
  Managed route creation/removal preserved pre-existing Serve configuration. A
  temporary port 18443 was unreachable on this tailnet; port 443 passed.
- LAN browser login and both prior local/SSH agent conversations remained intact
  after the managed update. The test installation retains the added speech
  services; disposable tasks and the Tailscale qualification route were removed.

This validates a signed-in Windows desktop deployment, not an unattended Windows
system service. Sleep suspends availability. Windows ARM64 and Server are outside
the supported target. Docker Desktop startup must be enabled for sign-in recovery.
Native agent helpers require Node.js 22 or newer; provider CLIs and authentication
remain the user's installation.

Hosted PR checks are tracked on [PR #431](https://github.com/yoloyash/overtchat/pull/431).
Public GitHub release downloads, release promotion, and download-time Windows
reputation behavior have not been qualified: no release has been published.
Authenticode inspection confirms the candidate binaries are unsigned. OvertChat
Cloud enrollment, CPU STT, and providers other than OMP were not requalified on
this Windows host. Existing model credentials were never printed.

The test backend remains running on the PC in
`%USERPROFILE%\overtchat-windows-test\data with spaces\OvertChat`.
The one-off setup/restart task and abandoned fixture connector task were removed;
only the installed connector task remains. Docker Desktop start-at-sign-in was
enabled with the user's authorization. The original worktree is retained as an
unchanged backup; all current implementation changes are in the main checkout.
