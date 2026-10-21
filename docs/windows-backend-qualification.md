# Windows backend qualification — 2026-10-20

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

## Evidence boundaries

This validates a signed-in Windows desktop deployment, not an unattended Windows
system service. Sleep suspends availability. Windows ARM64 and Server are outside
the supported target. Docker Desktop startup must be enabled for sign-in recovery.
Native agent helpers require Node.js 22 or newer; provider CLIs and authentication
remain the user's installation.

Hosted PR checks are tracked on [PR #431](https://github.com/yoloyash/overtchat/pull/431).
Public GitHub downloads, release promotion, and download-time Windows
reputation/signing behavior have not been qualified: no release has been published. STT,
realtime voice calls, Cloud/Tailscale access, and every individual provider were
not requalified on this Windows host. CPU/GPU TTS, LAN access, and OMP local/SSH
were exercised with real services. Existing model credentials were never printed.

The test backend remains running on the PC in
`%USERPROFILE%\overtchat-windows-test\data with spaces\OvertChat`.
The one-off setup/restart task and abandoned fixture connector task were removed;
only the installed connector task remains. Docker Desktop start-at-sign-in was
enabled with the user's authorization. The original worktree is retained as an
unchanged backup; all current implementation changes are in the main checkout.
