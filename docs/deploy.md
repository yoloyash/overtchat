# Deploy

Supports x86-64/arm64 Linux and Intel/Apple Silicon Macs. The guided manager
installs and updates OvertChat with Docker Compose.

## Install

For a guided overview, start with [Set up a server](https://overtchat.com/setup/).

```sh
curl -fsSL https://overtchat.com/install | sh
```

Choose where to access OvertChat, local search, speech, and voice services,
and whether to check for updates. The wizard generates the configuration and
secrets; no `.env` file editing is needed. On Linux, it installs Docker if needed.
Open the printed URL, create the administrator account,
and add your model endpoint in the web app.

```sh
overtchat setup     # change access, services, or update notifications
overtchat status    # check versions and service status
overtchat update    # update the managed stack
overtchat logs -f   # follow container logs
overtchat reset-password # recover an account password
```

Voice requires both STT and TTS. Bundled Parakeet and Kokoro support native
Apple acceleration on Apple Silicon with macOS 14 or later, and CPU or NVIDIA
GPU containers on Linux. CPU containers remain available on Macs, including
Intel Macs. Setup can install NVIDIA Container
Toolkit on supported systems. Kokoro needs roughly 3–4 GB VRAM, so choose CPU
if GPU memory is limited.

### macOS

Install and start [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/),
then run the installer as your normal user while logged in to the Mac desktop.
Agent Connections run as a LaunchAgent and start at login. Enable Docker
Desktop's start-at-login setting to start the stack automatically.

Connector logs are in `~/Library/Logs/OvertChat/connector.log` and
`connector.error.log`, each limited to 10 MiB with three rotated backups.

Setup recommends native Apple acceleration for new speech installations on
Apple Silicon with macOS 14+. Existing installations retain their selection;
run `overtchat setup` to switch between Apple acceleration and CPU containers.
Web/mobile continue using the bundled speech providers.

The CLI installs private Python, FFmpeg and model files (several GB) and manages
a LaunchAgent. Speech requires a logged-in desktop user and an awake Mac;
models share system memory and requests queue on one worker. Docker Desktop
connects to the authenticated loopback service on port 5093.

`overtchat status` reports readiness and the log path. Runtimes, downloads and
`speech.log` live in the managed stack's `apple-speech/` directory and are not
automatically pruned. Setup restores speech routing and the previous native
service on failure; it does not downgrade the app or database.

## Password recovery

On web, desktop, and mobile, **Forgot password?** explains how to get help.
Ask an administrator to open **Settings → Users → Reset password** for your
account. Another administrator can also reset an admin account. The acting
administrator must enter their own current password, then enter and confirm
the replacement. Share the replacement privately. Users can change it afterward
in **Settings → Security**; there is no forced change at the next login.

If the only administrator, or all administrators, are locked out, run this on
the server as the operating-system user who manages the installation:

```sh
overtchat reset-password
```

The command requires an interactive terminal and a running app. It reads the
saved installation and its management secret, verifies the installation at its
local port, and prompts for the account email and the replacement password twice.
Passwords are masked and never passed as command-line arguments. It does not
require an OvertChat login, follow redirects, or use the public access URL. Use
the same `OVERTCHAT_CONFIG_DIR` override as setup if the installation uses a
custom location. An older app or CLI must be updated to support this command.

Every successful recovery signs out all of that account's web, desktop, and
mobile sessions. Sign in again with the replacement password. Chats, settings,
and administrator/user roles are preserved. Other accounts remain signed in.
Recovery does not enable email delivery or provide public self-service reset links.

### Manual installations without the management CLI

The running app also accepts recovery at
`POST /api/internal/management/password-reset`, authenticated with the app's
`OVERTCHAT_MANAGEMENT_SECRET`, not a user or Host Connector token. If this secret
is unset, generate a random value of at least 32 characters, configure it in the
app's environment, and recreate/restart the app using your existing deployment
procedure. Keep `BETTER_AUTH_SECRET` and the data mount unchanged.

With Python 3 available on the server host, run the following interactive command.
Enter the app's published local port (normally 4718 for Compose, or 4717 for a
source server) and the matching management secret. Both the secret and passwords
are hidden; the request goes only to loopback and refuses redirects:

```sh
python3 -c '
import getpass, json, urllib.request, urllib.error
port = int(input("Local app port: "))
if not 1 <= port <= 65535:
    raise SystemExit("Invalid port.")
secret = getpass.getpass("Management secret: ")
email = input("Account email: ").strip().lower()
password = getpass.getpass("New password: ")
if not 8 <= len(password) <= 128:
    raise SystemExit("Use between 8 and 128 characters.")
if password != getpass.getpass("Confirm new password: "):
    raise SystemExit("Passwords do not match.")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
request = urllib.request.Request(
    f"http://127.0.0.1:{port}/api/internal/management/password-reset",
    data=json.dumps({"email": email, "newPassword": password}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
    method="POST",
)
try:
    with opener.open(request, timeout=15) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f"Recovery failed (HTTP {error.code}). Check the email, secret, and app version.")
except urllib.error.URLError:
    raise SystemExit("Could not reach the local app.")
if result.get("status") is not True:
    raise SystemExit("The server did not confirm recovery.")
print("Password reset. All sessions for this account have been signed out.")
'
```

## Choose how to access OvertChat

First-time installation and `overtchat setup` use the same access question.
Rerunning setup preselects the saved choice and lets you change it without
reinstalling or losing data. Updates preserve the choice. A dry run renders a
preview without saving new installation settings or changing Tailscale routes.
If an access reconfiguration fails to start, setup attempts to restore the
previous network settings. It does not downgrade the app or roll back database
migrations. The previous Tailscale route is retained until startup succeeds.

| Choice | Behavior |
| --- | --- |
| Only on this computer | Opens at `http://localhost:4718`; the published port listens only on loopback. |
| On my home network | Detects a LAN address and configures login for that address and localhost. The published port listens on all interfaces, subject to the host firewall. |
| From anywhere with Tailscale | Uses Tailscale Serve to provide private HTTPS access to an app listening on loopback. |
| Advanced setup | Uses your HTTPS address through an existing Cloudflare Tunnel or another reverse proxy. |

Fresh installations suggest the home network option when a LAN address is
detected, otherwise local access. The final output labels the address to use
on this computer or other devices. `localhost` always means the device opening
the address; it does not refer to your server from your phone.

Use **Customize the port or additional addresses?** to change the app port or
add browser addresses. When the main address uses HTTPS, additional addresses
must also use HTTPS because authentication uses secure cookies. These are
accepted login addresses; DNS, proxies, and network reachability must also be
configured. Setup handles the authentication environment automatically.

### Tailscale

Install and connect Tailscale on the OvertChat host first. Setup checks that
Tailscale is available, signed in, connected, and has a device DNS name. If it
is missing, it shows **Tailscale not found** and lets you retry or select another
access option. For sign-in, a stopped connection, or pending device approval,
setup explains the next step. It does not install Tailscale or sign in for you.

Setup configures a persistent background Serve route to the app's loopback
port. It uses HTTPS port 443 when available; if another app uses that port, you
can choose another HTTPS port. Existing Serve routes and public Funnel
configuration are inspected before any changes. Setup only manages its own
recorded route and never resets the device's Serve configuration.

On Linux, the current user needs permission to manage Tailscale Serve. If needed,
run `sudo tailscale set --operator=<your-linux-username>`. If HTTPS needs enabling,
complete the link printed by Tailscale and retry. See
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).
The first HTTPS request may wait while Tailscale issues a certificate. If the
initial check times out, wait briefly and retry.

Open the printed `https://<device>.<tailnet>.ts.net` address on a device connected
to Tailscale and sign in to OvertChat normally. Access follows your Tailscale
network permissions. Serve resumes after a host restart. Changing access mode
or ports removes the previous OvertChat Serve route; externally changed routes
must be resolved before setup can remove them.

### Cloudflare Tunnel or another reverse proxy

Select **Advanced setup**, enter the HTTPS address you will open (for example,
`https://chat.example.com`), choose Cloudflare Tunnel or another reverse proxy,
then select where it runs:

| Tunnel/proxy placement | Service destination |
| --- | --- |
| Directly on the OvertChat host | `http://127.0.0.1:4718` (or the selected app port) |
| Docker on the same host | `http://app:4717`, with the proxy connected to OvertChat's Docker network |
| Another computer | `http://<OvertChat host LAN IP>:4718` (or the selected app port); allow the proxy through the host firewall |

For Docker, setup prints the external network name, normally
`overtchat_default`. Attach the proxy container to that network and declare it
as an external network in the proxy's Compose configuration so the connection
survives recreation. `localhost` inside a proxy container refers to that
container. Same-host proxy modes keep the app's published port on loopback;
the remote proxy option publishes it on all interfaces.

For Cloudflare, create a published application route with your hostname and
the service destination above. Manage your tunnel, domain, and credentials in
Cloudflare; OvertChat does not install `cloudflared` or collect tunnel tokens.
See [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/).
Other reverse proxies must terminate HTTPS and support WebSocket upgrades.

Choose **Check connection** after configuring the route. Setup verifies that
the address reaches this particular installation without sending management
credentials to the public address. It checks HTTPS using normal certificate
validation and does not follow redirects to an access gateway. This confirms
the app route, not every client device's permissions or WebSocket support.
The check compares a public installation ID from `/api/ping`; this is a routing
check, not authentication. An older app without that ID needs updating before
the check can succeed.

You can retry or finish with **Connection pending**, then rerun `overtchat setup`
after configuring the tunnel. `overtchat status` reports the last check result.
When switching away from an externally managed tunnel or proxy, remove its
route in that service as well; setup only removes routes it manages in Tailscale.

## Connect models and services

Service URLs must be reachable **from the app container**:

- On the same host: `http://host.docker.internal:<port>`.
- On another machine: its LAN URL.
- Existing search or speech: select it in `overtchat setup`.
- MCP: configure under **Settings → Tools**. STDIO commands run in the container.

Use HTTPS for browser microphone access outside localhost. Reverse proxies
must support WebSocket upgrades; realtime voice uses the app's existing origin.

**Test connection** under text-to-speech or speech-to-text checks the values on
screen without saving them. It requests a short audio sample for TTS or sends
silent audio for STT, so no microphone access is needed. This checks connectivity
and the response format, not speech quality. Leave the API key field empty to
use the stored key.

Coding-agent executables and credentials belong on the Host Connector machine
or selected SSH host. Configure connections on the web before using them on
Android or iOS.

Hermes uses its native ACP interface. Install and configure Hermes on the
connector machine or SSH target, then verify `hermes acp --version` and
`hermes acp --check`. If ACP dependencies or credentials are missing, follow
the [Hermes ACP setup guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/)
and run `hermes model` on that host. Refresh agent discovery in OvertChat and
select Hermes when creating a workspace session. Its existing configuration,
memory, skills, tools and credentials remain on the execution host.

Hermes sessions support streaming, images, tool approvals, model and permission
selection, cancellation, queued messages, steering and context compression.
Steer uses ACP cancellation: cancel the current turn, wait for
cancellation to finish, then send the queued message as a normal prompt in the
same session. It supports images when the selected model does. This interrupts
current work; effects from tools that already ran are not undone.
ACP session history can be reopened after connector restarts; Hermes CLI/gateway history
is not included. Message forks, rewind, session renaming and
reasoning controls are not exposed by this integration. Approval choices keep
the scope Hermes advertises, including permanent versus session-only grants.
The web app and connector must use the same connector protocol; the current
source requires protocol 6. Follow the coordinated update procedure below.
Connector event requests are byte-bounded and oversized individual events use
acknowledged fragments. If delivery repeatedly fails, include the metadata-only
`[connector:delivery]` log lines (bytes, event count, fragment index, HTTP status)
with the startup diagnostics. A restart retains unacknowledged journal events;
do not delete connector state to clear a backlog.

The connector journal is SQLite with WAL, at the existing
`connector-<id>.state.json` path (the filename is retained for managed upgrades).
Startup streams older JSON journals into a staging database, validates their
events and command receipts, then atomically replaces the journal after commit
and checkpoint. The original JSON remains at `<state-file>.legacy`. Keep that
archive until the updated connector has been verified; it is a migration archive,
not a current backup after new commands run. Older connectors cannot read the
SQLite journal. Recovery after normal operation uses a compatible newer version,
not an older binary with stale state.

Agent display timelines survive model changes, compaction, and connector/runtime
restarts. Existing displayed history is retained as-is, including any misplaced
rows from older versions; upgrades do not automatically rebuild it.

Use `/reload` in an idle Agent Connections conversation to deliberately replace
the displayed history with the agent's current native branch, including changes
made outside OvertChat. Finish or stop the turn and clear queued messages first.
The import commits atomically and can omit older rows already compacted out of
native history. If it fails, the prior displayed history remains intact.
Normal page refreshes and connector restarts retain the display history instead.

Every journal mutation commits before it can be acknowledged. Startup holds an
exclusive journal lock and removes abandoned regular temporary files matching
this journal's old writer format, plus interrupted migration staging files.
It leaves live-writer files, symlinks, canonical timelines, and rollback archives
alone. If the disk is already full, stop the connector before recovery; never
delete the main journal, its WAL, or canonical histories to regain space.

For a consistent journal backup, stop the connector service and run:

```sh
overtchat-connector journal-backup --destination /absolute/path/to/new-snapshot
```

The destination must be new. SQLite backups include committed WAL data and are
verified with `integrity_check`; copying only the main database file can miss
committed events. The managed installer uses this command while the service is
stopped. On a failed upgrade it restores the standalone snapshot after removing
the failed attempt's WAL/SHM, before restarting the previous binary. Back up the
canonical timeline and process-ledger directories separately while stopped.

The connector records its OpenCode and Hermes helper processes beside its state journal
in `<state-file>.processes/`. On restart it verifies process identities and
cleans up recorded leftovers locally or through the original SSH alias in the
background, allowing the connector to connect even when remote hosts are offline.
New managed launches still await recovery for their target. Shutdown cancels
background probes and finishes their ledger work before releasing the instance lock.
Unreachable SSH hosts retain their records and are retried before the next
managed agent launch on that host. Preserve this directory with the connector state;
servers left behind by older versions without records are not automatically
reaped. Stopping a session aborts its work; other sessions sharing the same
OpenCode server remain available.

## Share with your family

Add accounts under **Settings → Users → Add user**, then share their login
details and your server's LAN or HTTPS URL. Everyone uses the enabled models
with their own chats and projects. Only the first account uses public signup;
administrators create subsequent accounts.

## Desktop

The desktop app connects to your existing OvertChat server. It does not install
the server or run models locally. First install or update the server using the
manager above, then choose your platform on the
[downloads page](https://overtchat.com/downloads/). The
[release log](https://overtchat.com/releases/) also lists archives, checksums,
and previous versions. Drafts and prereleases are not listed there.
Desktop 0.1.0 requires the API-level-1 server contract introduced
in server 0.23.0; older released servers cannot run it. The app checks API
compatibility before loading your chats and explains when the server or app
needs updating.

The connection screen looks for OvertChat on this computer at ports 4718
(managed installations) and 4717 (source installations), plus a custom port
recorded by the local manager. Select **Connect** beside a discovered server,
or enter your server URL, then sign in with your existing account. Use
**Check again** after starting a server. Discovery does not select a server
until you click Connect, and later launches use your saved server. Servers on
other computers still require their address.

### macOS desktop

Choose `mac-arm64.dmg` for Apple Silicon or `mac-x64.dmg` for Intel. Open the
downloaded DMG, drag **overtchat** to Applications, and launch it from there.
Published Mac downloads are Developer ID signed and notarized. ZIP downloads
are also available for each architecture.

Sign in with your existing account. When macOS first asks for access to
**overtchat Safe Storage**, choose **Always Allow** to retain
sign-in across launches. Allow microphone access when using voice features.
Use **Change Server** in the app menu to connect to another installation.

### Linux desktop

Linux downloads support **x64**. Use the `.deb` on Debian/Ubuntu, including
Ubuntu 24.04, or the `.rpm` on Fedora:

```sh
sudo apt install ./overtchat-0.1.0-linux-x64.deb
# Fedora instead:
sudo dnf install ./overtchat-0.1.0-linux-x64.rpm
```

Replace the version in these filenames with your downloaded release. Launch
**overtchat** from the application menu or run `overtchat-desktop` as your
regular user. The existing `overtchat` command manages the server.

AppImage and tar.gz downloads require working unprivileged user/network
namespaces. Check with `unshare --user --map-root-user --net true`. If your
system blocks them, use the native package; do not disable the sandbox with
`--no-sandbox`. Ubuntu 24.04's default AppArmor policy can block portable builds.

For AppImage, make the file executable and launch it:

```sh
chmod +x overtchat-linux-x64.AppImage
./overtchat-linux-x64.AppImage
```

If mounting is unavailable, add `--appimage-extract-and-run`. The sandbox
requirements still apply. For tar.gz, extract the archive and run its
`overtchat-desktop` executable. Portable formats do not install menu entries.

Saved sign-in requires GNOME Secret Service or KDE Wallet. Without a usable
credential store, sign in again after quitting; the app keeps your session only
until you quit.

### Desktop updates

Installed macOS, Linux AppImage, `.deb`, and `.rpm` builds check for desktop
updates at startup and every ten minutes. Returning to the app or waking the
computer also checks, at most once per minute across those activity events.
An available or downloaded update stays visible during background checks.
Click the desktop download icon next to your sidebar profile to download in
the background. It shows download progress, then an update-ready icon.
Click it and choose **Update and restart**,
or **Later** to keep chatting. Quitting normally does not install the update.
Native **Check for Updates…**
also works before sign-in. Linux package updates may prompt for administrator
authentication. Keep AppImages in a writable location.

The separate server icon opens update instructions and appears for administrators.
`overtchat update` updates the server stack. A desktop update requiring a newer
server waits until the server is updated; ask its administrator if needed.

Tar archive installations update manually. For these, or to recover from an
update failure, verify downloads against the release's SHA-256 checksum file,
quit the app, and replace it or install the newer package. Settings and securely
saved sign-in are retained. Builds installed before the in-app updater was added
need one manual upgrade. Linux package removal preserves your user settings.
Windows and Linux ARM64 downloads are not yet available.

## Mobile

Install from [Google Play](https://play.google.com/store/apps/details?id=com.overtchat.mobile)
or the [App Store](https://apps.apple.com/us/app/overtchat/id6812165221), enter
your server URL, and sign in. Use an address reachable from the phone;
`localhost` refers to the phone itself.

### Sideload an APK (Android)

1. Open [Releases](https://github.com/yoloyash/overtchat/releases) and choose the
   newest **`mobile-v*`** release (`v*` releases are for the server).
2. Download and open `overtchat-v<version>.apk`. Allow installation from your
   browser or file manager if prompted.

Repeat for updates; sideloaded builds do not auto-update.

## Update or adopt an existing installation

`overtchat update` prints the component version changes and updates the CLI,
app, selected services, and managed connector while preserving data. Rerun it
if interrupted. `overtchat update --check` only reports available versions and
does not require Docker; add `--json` for structured output.

Agent Connections are optional. Setup checks their service prerequisites before
changing the app. If that check or connector installation fails, interactive
setup/update offers **Retry** or **Finish without Agent Connections for now**.
The rest of the installation finishes, and the final output identifies the
connector as pending. Unattended runs continue with the same warning.
Working app and speech components are retained; a connector failure does not
roll them back. Other installation failures still stop setup/update.

The agent selection stays saved so the next `overtchat setup` or `overtchat update`
retries it. `overtchat status` reports **setup pending**, including when a previous
connector is still online. To stop managing Agent Connections, run setup and
select **Set up later** at **Install Agent Connections?**; this skips future
connector installation attempts but does not uninstall an existing service.

Setup asks **Automatically check for updates?**, with **Yes (recommended)**
selected for new installations. This enables release notifications in the
administrator account menu. The app contacts overtchat.com to check for new
releases; install updates by running `overtchat update`.
To change notifications, rerun `overtchat setup` and choose Yes or No. Setup
preselects your saved preference, and updates preserve it.

To adopt a standard existing `overtchat-app` container, run `overtchat setup`.
It preserves the data mount, port, auth secret, and standard SearXNG settings,
and verifies a database snapshot before migrating. It also adopts manually
paired connectors. For stopped stacks, setup can recover one Compose data
volume; if several are found, start the intended stack first. Back up custom
or source installations before migrating to the managed layout.

## Manage and troubleshoot

Running `overtchat` shows command help and, for a managed installation, its
status. Every command supports `--help`.

- `overtchat version` and `overtchat --version` print only the CLI version for
  compatibility with older self-updaters. `overtchat version --all` reports
  selected components with running and configured versions.
- `overtchat status` shows live container health, app readiness, connector
  connectivity, native speech readiness, the access URL, and storage paths.
  Unavailable components retain their configured version with unknown running
  versions. A container without a health check is reported as running, not ready.
- `version` and `status` support `--json`.

## Logs and backup

```sh
overtchat logs --tail 100             # all selected container services
overtchat logs app --follow
overtchat logs connector --follow    # systemd journal or macOS log files
overtchat logs speech --follow       # native Apple speech
overtchat logs install --tail 100     # setup/update phases and failure diagnostics
```

Service names are `app`, `redis`, `search`, `tts`, `stt`, `voice`, `connector`,
`speech`, and `install`. Container and speech logs require a saved installation;
connector and installation logs are available even if setup failed before saving
its configuration. Log output may contain application data; review it before
sharing.

Setup/update displays individual connector phases and elapsed time during waits.
Permission prompts pause the spinner. Unattended runs do not prompt for sudo;
if permission is unavailable, Agent Connections remain pending.
The private `~/.config/overtchat/install.log` records phases, failures, and a short
connector service log excerpt collected before recovery. Known management/provider
credentials and connector tokens are redacted. It does not record configuration
stdin, environment files, or a full transcript of inherited interactive/Docker
output. The file is retained between attempts and rotated to `install.log.previous`
at the next run after exceeding 5 MiB. The printed path follows a configured
`OVERTCHAT_CONFIG_DIR`. If the log cannot be written, terminal diagnostics remain
available.

For an installation problem, include your OS, the setup/update command, its final
error or warning, `overtchat status`, and `overtchat logs install --tail 100`.
For connector startup failures, also include `overtchat logs connector --tail 50`.

```sh
docker logs -f overtchat-app
docker logs -f overtchat-voice  # when installed

# Snapshot the live database and copy it to the host
docker exec overtchat-app node -e '
const db = new (require("better-sqlite3"))("/app/data/chat.db");
db.backup("/app/data/backup.db").then(() => db.close()).catch(error => {
  console.error(error); process.exitCode = 1; db.close();
});
'
docker cp overtchat-app:/app/data/backup.db ./backup.db
```

Configuration is in `~/.config/overtchat`; generated stack files and service
data are in `~/.local/share/overtchat`. Use the manager to change configuration;
setup and updates may replace manual edits to generated files.

A `307` redirect to login is normal. For login loops or port conflicts, run
`overtchat setup` and correct the public URL or port.

## Manual source Compose configuration

Use this section when you manage Compose directly from a source checkout.
The repository `.env.example` documents optional settings for that workflow.
For guided installations, change these settings with `overtchat setup`; the
manager generates its own environment files.

For a manually managed checkout, set `BETTER_AUTH_URL` to the browser address,
`APP_PORT` to the published port, and `APP_BIND_ADDRESS` to `127.0.0.1` for local
access or `0.0.0.0` for network access. `EXTRA_TRUSTED_ORIGINS` accepts additional
browser addresses separated by commas. Include the scheme and port.

The source Compose defaults publish port 4718 on all interfaces but configure
authentication for `http://localhost:4718`. To use a LAN IP or domain, set the
browser address accordingly and recreate the app container. Changing the auth
address does not change which network interfaces listen. Use the guided manager
for automatic coordination of these settings.

For manual Compose, `DISABLE_UPDATE_CHECK=true` disables release notifications.
Guided installations expose this preference in `overtchat setup`.

[Development setup](development.md) · [Release process](release.md)
