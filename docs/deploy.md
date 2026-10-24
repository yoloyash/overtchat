# Deploy

Supports x86-64/arm64 Linux, Intel/Apple Silicon Macs, and x64 Windows 11 PCs.
The guided manager installs and updates OvertChat with Docker Compose.

## Install

For a guided overview, start with [Set up a server](https://overtchat.com/setup/).

```sh
curl -fsSL https://overtchat.com/install | sh
```

On Windows, use the PowerShell command in [Windows](#windows) instead.

Choose where to access OvertChat, local search, speech, and voice services,
and whether to check for updates. The wizard generates the configuration and
secrets; no `.env` file editing is needed. On Linux, it installs Docker if needed.
Open the printed private setup link, create the administrator account,
and add your model endpoint in the web app. The link prefills a one-time setup
code that proves you operate this server. If you open the regular server address,
enter the code manually. Run `overtchat status` on the server to show the link
again; the code is also available in `overtchat logs` before setup completes.

The code survives restarts and stops working after the administrator account is
created. Treat the link and code as private until then. Existing installations
with accounts do not require a code. This is only for initial setup; use
[password recovery](#password-recovery) if you cannot sign in afterward.

```sh
overtchat setup     # change access, services, or update notifications
overtchat status    # check versions and service status
overtchat update    # update the managed stack
overtchat logs -f   # follow container logs
overtchat reset-password # recover an account password
```

Only one setup or update runs at a time; if another is running, wait and retry.
Updates keep the existing connector pairing. If replacing the CLI or connector
fails or is interrupted, rerun the same command as the same user with the same
directory overrides. It restores the previous executable, or finishes the
replacement, before continuing. Keep `.previous` and `.update.json` files beside
the executables until then. On Windows, if `overtchat` is missing after an
interrupted update, rerun the PowerShell installer. Recovery covers executables,
not database migrations.

Without a terminal, or with `setup --defaults`, setup and update exit with an
error if selected Agent Connections could not be set up. The app itself is still
running; check `overtchat logs install` and rerun. Interactive setup lets you
finish without them.

Voice requires both STT and TTS. Bundled Parakeet and Kokoro support native
Apple acceleration on Apple Silicon with macOS 14 or later, and CPU or NVIDIA
GPU containers on Linux and on Windows with Docker Desktop/WSL 2. CPU containers
remain available on Macs, including Intel Macs. Setup can install NVIDIA Container
Toolkit on supported Linux systems. Kokoro needs roughly 3–4 GB VRAM, so choose CPU
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

### Windows

Windows needs an x64 PC with Windows 11 and
[Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)
using the WSL 2 backend and Linux containers. Start Docker Desktop once to finish
its first-run setup, and enable **Start Docker Desktop when you sign in**. For
Agent Connections, also install your provider CLIs and sign in to them as your
desktop user. The connector bundles its own Node.js runtime.

In 64-bit PowerShell, as your normal desktop user (not administrator), run:

```powershell
irm https://overtchat.com/install.ps1 | iex
```

The installer verifies the release checksum, installs `overtchat.exe` in
`%LOCALAPPDATA%\Programs\OvertChat\bin`, adds it to your user PATH (reopen other
terminals to use it), then starts setup. Run setup and updates from the desktop
session rather than over SSH: Docker Desktop's credential helper can fail image
pulls from an SSH logon with "A specified logon session does not exist".

The Windows binaries are not code-signed yet. Smart App Control or organization
policies may block them; do not disable those protections to install OvertChat.

| Data | Location |
| --- | --- |
| Configuration, secrets, install log | `%LOCALAPPDATA%\OvertChat\config`, accessible only to your user and SYSTEM |
| Compose files | `%LOCALAPPDATA%\OvertChat\stack` |
| Connector runtimes | `%LOCALAPPDATA%\Programs\OvertChat\connector`, launched by `bin\overtchat-connector.cmd` |
| Database | The managed Docker volume |

Resetting or uninstalling Docker Desktop or WSL can delete the volume; back up the
volume and the configuration directory first. Custom `OVERTCHAT_CONFIG_DIR` and
`OVERTCHAT_STACK_DIR` values must be dedicated directories, because the manager
replaces the configuration directory's permissions.

The Host Connector runs as a Task Scheduler task for your signed-in user, without
administrator rights or a stored password, and restarts if it exits with an
error. It uses your Windows provider credentials and `%USERPROFILE%\.ssh\config`,
so native and SSH agents both work. OvertChat is only available while the PC is
awake and you are signed in; it is not a Windows system service.

```powershell
overtchat status
overtchat update
overtchat logs connector --tail 100
overtchat logs install --tail 100
```

Connector logs rotate in the configuration directory's `windows-service` folder.
`overtchat-connector service-stop` stops and disables the task, `service-install`
enables and starts it again, and `service-uninstall` removes only the task,
keeping credentials and session history. Custom installations must set the same
`OVERTCHAT_CONNECTOR_CONFIG` for these commands.

NVIDIA speech acceleration uses Docker Desktop's WSL GPU support. Install a
current NVIDIA Windows driver, not Linux drivers or the NVIDIA Container Toolkit.
Setup checks GPU access inside a container before selecting CUDA; CPU speech
works without a GPU.

LAN access is subject to Windows Firewall; allow the app port only on private
networks you intend to serve. Windows ARM64, Windows Server, and service-account
deployments are not supported.

## Minimal Compose

Use [`compose.minimal.yml`](../compose.minimal.yml) to run only the app and
Redis without installing anything on the host. It works with Docker Compose,
`podman-compose`, and Docker Compose against a rootless Podman socket. It uses
only named volumes, so no SELinux relabeling or host path ownership is needed.

1. Download it into an empty directory and rename it `compose.yml`.
2. Set `BETTER_AUTH_URL` and `HOST_CONNECTOR_URL` to the address you open in
   your browser. Keep the published port on `127.0.0.1` behind a reverse proxy,
   or change it to `"4718:4717"` to listen on every interface.
3. Create the session secret beside the file. Compose refuses to start without it:

   ```sh
   echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" > .env
   ```

4. Start the stack and read the setup code from the app's logs:

   ```sh
   docker compose up -d        # or: podman compose up -d
   docker compose logs app     # [setup] Create your administrator account with setup code …
   ```

Keep `.env` and the `overtchat-data` volume. Changing `BETTER_AUTH_SECRET`
signs everyone out and invalidates stored two-factor secrets.

This stack has no bundled search, speech, or voice containers. Configure Brave
or an existing SearXNG instance, and OpenAI-compatible TTS or STT, under
**Settings → Services**. Redis lets an interrupted response resume after a
reload; remove the `redis` service and `REDIS_URL` to run without it. Reverse
proxies must forward WebSocket upgrades (see
[Cloudflare Tunnel or another reverse proxy](#cloudflare-tunnel-or-another-reverse-proxy)).
To reach a model server on the host, use `host.containers.internal` with Podman;
with Docker, add `extra_hosts: ["host.docker.internal:host-gateway"]` to `app`.

Coding agents do not need to run on this server. Install the Host Connector on
the computer with your agents and projects: open **Settings → Connections**
and run the displayed command there. The connector only makes outbound HTTPS and
WebSocket connections to `HOST_CONNECTOR_URL`. The app container needs no
access to SSH keys, the Docker or Podman socket, or host directories. Standalone
connectors support Linux and macOS.

For password recovery, see
[manual installations without the management CLI](#manual-installations-without-the-management-cli).

### Minimal Compose updates

Administrators see **Server update available** in the account menu when a newer
stable release is published. Because the file sets
`OVERTCHAT_UPDATE_METHOD=compose`, the notice shows the Compose steps rather
than the management CLI. `DISABLE_UPDATE_CHECK=true` turns the check off.

To update manually, change the image tag (or set `APP_VERSION` in `.env`), then
run `docker compose pull && docker compose up -d`. Database migrations run at
startup and are forward-only; never move to an older tag. Back up first:

```sh
docker compose exec app node -e '
const db = new (require("better-sqlite3"))("/app/data/chat.db");
db.backup("/app/data/backup.db").then(() => db.close()).catch(error => {
  console.error(error); process.exitCode = 1; db.close();
});
'
docker compose cp app:/app/data/backup.db ./backup.db
```

For automatic updates, use `ghcr.io/yoloyash/overtchat-app:latest`, which moves
only after a release is promoted to stable. With Podman, also uncomment the
`io.containers.autoupdate` label in the file and run the stack as
[systemd units](#start-on-boot-with-rootless-podman). Then enable the daily check:

```sh
podman auto-update --dry-run    # shows whether a newer image is available
systemctl --user enable --now podman-auto-update.timer
```

If the updated container fails to start, Podman restores the previous image but
not the database, so keep backups. With Docker, a tool that watches image tags
can update or notify for `:latest` in the same way.

### Start on boot with rootless Podman

The stack uses `restart: always`, which is the policy Podman's
`podman-restart.service` starts at boot. Enable it and allow your user's
services to run without a login session:

```sh
systemctl --user enable podman-restart.service
loginctl enable-linger "$USER"
```

Alternatively, run the containers as systemd units, which automatic updates
require. Start the stack once with `podman compose up -d` to create its
network, volume, and containers, then replace the containers with units. These
commands use the default `podman-compose` names for a directory called
`overtchat`:

```sh
mkdir -p ~/.config/systemd/user && cd ~/.config/systemd/user
podman generate systemd --new --files --name overtchat_redis_1
podman generate systemd --new --files --name \
  --after container-overtchat_redis_1.service \
  --requires container-overtchat_redis_1.service overtchat_app_1
# Let each unit, not podman-compose, own its container.
sed -i '/PODMAN_SYSTEMD_UNIT=podman-compose/d' container-overtchat_*.service
chmod 600 container-overtchat_*.service
podman rm -f --depend overtchat_redis_1
systemctl --user daemon-reload
systemctl --user enable --now container-overtchat_redis_1.service container-overtchat_app_1.service
loginctl enable-linger "$USER"
```

The units contain the app environment, including `BETTER_AUTH_SECRET`; keep
them private like `.env`. From then on, manage the stack with `systemctl --user`
rather than `podman compose`. To apply Compose file changes, run
`systemctl --user disable --now container-overtchat_app_1.service container-overtchat_redis_1.service`,
then `podman compose up -d`, and repeat these steps.

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

## Two-factor authentication

Anyone can turn on two-factor in **Settings → Security**: confirm the password,
scan the QR code with an authenticator app such as 1Password, Google
Authenticator, or Authy (or type the key), enter a code, and save the ten
backup codes. Sign-in then asks for a code from the app after the password.
Each backup code works once; **New backup codes** replaces them.

### Approve sign-ins from a signed-in device

Instead of typing a code, a sign-in can be approved from a browser, desktop app,
or phone where the account is already signed in. The new sign-in shows a
two-digit number; the signed-in device asks "Is this you signing in?" with the
browser or app and its address, and the user picks that number from three.
Picking the wrong number or **No, it's not me** blocks the sign-in. Requests
expire after five minutes, and each account's sign-ins can send five per ten
minutes.

Open web and desktop windows check for requests while visible. The mobile app
checks while open and, with **Settings → Notifications → Sign-in requests** on,
receives them as push notifications. The notification only says someone is
signing in (with **Show previews**, also which browser or app); the request is
loaded and answered over the app's own login. An authenticator app is still
required to turn two-factor on and remains the fallback, with backup codes, on
every sign-in. The address shown comes from the same forwarded-address header
that sign-in rate limiting uses; when no proxy sets it, no address is shown.

An administrator can remove another user's authenticator, for example after a
lost phone, in **Settings → Users → Reset two-factor**. The acting administrator
enters their own current password. If every administrator is locked out, run
this on the server the same way as [password recovery](#password-recovery):

```sh
overtchat reset-two-factor
```

Both remove the authenticator and backup codes and sign out all of that account's
sessions; the user signs in with their password and can set two-factor up again.
Manual installations can send `{"email": "..."}` to
`POST /api/internal/management/two-factor-reset` with the management secret,
like the password-recovery request above.

Setting `OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR=true` in the app's environment makes
administrators set up two-factor before they can use the app, and keeps them
from turning it off. Other users can still choose. Two-factor sign-in needs the
current web, desktop, and mobile apps; older apps ask the user to update. Older
apps keep using codes and never receive approval requests.

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
| From anywhere with OvertChat Cloud (beta) | Links this server to an OvertChat Cloud account and publishes it at `https://<name>.overtchat.app` through the OvertChat relay. |
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

### OvertChat Cloud

OvertChat Cloud gives this server an address such as
`https://smiths.overtchat.app` that works on any device, including for people
who don't use Tailscale. Nothing is installed on the devices that open it, and
no ports are opened on your network. It is in beta, with a limited number of
spots.

Choose **From anywhere with OvertChat Cloud (beta)**. Setup shows a code and a
link to `account.overtchat.com/device`; open the link on any device, sign in with Google,
and confirm that the code matches. If the account has no address yet, setup
asks for a name. Names use 3–30 lowercase letters, numbers, and hyphens, and
cannot be changed later. Setup then links the server, starts the tunnel, and
waits for the first HTTPS certificate, which can take a minute or two.

How it works:

- The `cloud-tunnel` container holds an outbound connection to the relay. The
  `cloud-proxy` container (Caddy) holds this server's HTTPS certificate from
  Let's Encrypt and forwards to the app. The app's port stays on loopback.
- Visitor connections are encrypted all the way to this server. The relay routes
  them by name without decrypting them, so it cannot read chats or passwords.
  The relay is open source at
  [yoloyash/overtchat-relay](https://github.com/yoloyash/overtchat-relay),
  whose README lists what it can see and how to check that visitors get this
  server's own certificate.
- The relay passes on each visitor's address, so sign-in rate limits apply per
  visitor rather than to the tunnel.
- The server's credential is stored with the other installation secrets. Linking
  another server to the same account replaces it, and the previous server's
  address stops working.

The address is public: anyone can reach the sign-in page, and every account on
the server can sign in from anywhere. Use strong passwords. Administrators must
set up [two-factor authentication](#two-factor-authentication) before they can
use the app, and other users are encouraged to. Choosing another
access option removes the tunnel and proxy containers, which takes the address
offline; the name stays reserved for your account.

Use `overtchat logs cloud` for the tunnel and `overtchat logs cloud-proxy` for
certificate status. Manage or delete the account at `account.overtchat.com`.

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

### Windows SSH workspaces

Native Windows OpenSSH targets can use either the default Command Prompt shell
or PowerShell. Keep the existing SSH alias and key configuration. The connector
detects the host before executing commands; selecting a Windows host does not
require changing its default SSH shell or installing a remote OvertChat service.

Install Node.js 22 and the desired Windows-compatible coding-agent CLI on the
target. Git for Windows is needed for repository features. These executables
must be available to the SSH user, which can have a different environment from
an interactive desktop terminal. The Windows bootstrap uses Windows PowerShell
5.1, including `Add-Type`, and Windows Job Objects to own the launched process
tree; restricted PowerShell environments that disallow `Add-Type` are unsupported.

If Node is installed outside the SSH PATH, set `OVERTCHAT_SSH_NODE_PATHS` in the
**connector's** environment to a JSON map of aliases to absolute executable paths:

```sh
OVERTCHAT_SSH_NODE_PATHS='{"gaming-pc":"C:\\Program Files\\nodejs\\node.exe"}'
```

Restart the connector after changing its environment. Refresh agent discovery
after installing a provider or changing the remote PATH. Successful host probes
are cached for one minute; refreshing provider discovery also invalidates that
cache. Windows discovery resolves native executables and `.cmd`/`.bat` wrappers.
Batch-wrapper arguments containing newlines or exceeding Windows command-line
limits require configuring the provider's native executable instead.

The helper keeps a heartbeat after the agent's stdin closes. SSH disconnects or
30 seconds without a heartbeat stop the owned process tree. A reconnect resumes
from provider session history; it does not keep executing an unattended turn.
Heartbeats continue while an agent is busy and not reading stdin. Pending agent
input is capped at 64 MiB; exceeding that limit stops the process with an explicit
error rather than allowing unbounded buffering.

Workspace paths may use drive-qualified paths such as `C:\Users\me\project`
or UNC paths such as `\\server\share\project`. Network shares still require
access from the SSH account. WSL reached through its own Linux SSH endpoint
remains a separate POSIX environment with Linux paths and provider installations.
A Windows server's own connector is installed by `overtchat setup`. Pairing a
standalone connector to another server supports Linux and macOS only; reach
other Windows PCs as SSH hosts.

### Coding-agent providers and connector operation

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

### Workspace terminals

The web and desktop agent workspace header includes a resizable terminal panel.
It opens one shared shell per workspace, in that workspace's directory, through
the Host Connector. Local shells run on the connector machine; SSH workspaces use
the connector's existing OpenSSH alias. The connector detects the target OS:
POSIX targets use their login shell, while Windows targets open an interactive
Windows PowerShell in the workspace directory. Windows requires an OpenSSH
server with ConPTY support (Windows 10 / Server 2019 or newer). Local shells on a
Windows connector use PowerShell 7 (`pwsh`) when it is on PATH, otherwise
Windows PowerShell.
The native mobile terminal UI is not supported.
Some Windows OpenSSH versions report exit code 0 for interactive sessions even
when the shell fails; consult the terminal's error output in that case.

The toolbar identifies the host and offers Find, Expand/Restore, and Close.
Expand keeps the same shell and restores the previous panel height. Stop and
Restart are in the terminal actions menu. Right-click the terminal for Copy,
Paste, Select all, Find, or Add to chat. Add to chat appends selected output to
the current draft for review; it never sends a message automatically.

Use Command-F on macOS or Ctrl-Shift-F on Windows/Linux to search terminal
output. Enter and Shift-Enter move between matches; Escape returns focus to the
shell. Search covers the output retained in the current view, highlights up to
1,000 matches, and supports case-sensitive matching. Command-C on macOS or
Ctrl-Shift-C on Windows/Linux copies selected text; Ctrl-C retains its shell
interrupt behavior. If the browser denies clipboard access, use the system
copy/paste shortcuts. Web URLs open in the browser; remote `localhost` URLs
are not automatically forwarded through SSH.

Closing the panel, refreshing the page, or briefly losing the connection leaves
the shell running. Stop terminates it; Restart creates a fresh shell. Stopping a
workspace or connection also terminates its shells. Shells are not durable across
connector restarts, host restarts, or a broken SSH session. Use a host-side
multiplexer separately when that durability is required.

The connector must be updated to a version advertising `workspace-terminal-v1`.
Terminal input and output use a separate outbound WebSocket connection through
the same server origin at `/api/agent-terminals/socket`. Reverse proxies must
forward WebSocket upgrades there, with idle timeouts longer than the 15-second
heartbeat. No additional public port or inbound connector listener is required.
The server's internal relay listens on loopback port 14717; do not publish it.
The relay is process-local, like the agent broker, so a deployment must use one
web server process for these connections.

Reconnect restores up to 2,000 scrollback lines, bounded to 4 MiB of text.
Multiple views share the shell; the most recently focused view controls its
dimensions. A slow viewer reconnects from the current screen if it falls behind.
There are at most 32 shells per connector. When terminal parsing falls behind,
the connector pauses PTY reads and resumes them after the queue drains. A noisy
command can slow down under this pressure; it is not terminated for producing
too much output. Terminal I/O is ephemeral and is not
stored in agent history or the connector journal.

Set `OVERTCHAT_DISABLE_AGENT_TERMINAL=1` in the connector service environment and
restart it to disable terminal support.

Host Connector release archives include Node.js and the native PTY module.
No separate Node installation is needed on the connector host. Each runtime is
stored under `~/.local/lib/overtchat/connector/` (on Windows,
`%LOCALAPPDATA%\Programs\OvertChat\connector`), and the service command stays at
`~/.local/bin/overtchat-connector`. Upgrades replace that launcher atomically.
`overtchat setup` and `overtchat update` then remove runtimes that neither the
launcher nor a pending rollback references; on Windows, a runtime still in use
is removed by a later update. The standalone upgrade installer restores the
previous launcher or legacy executable and the journal backup on failure, and
retains previous runtime directories so an older launcher remains usable. Do
not remove a directory referenced by the current launcher or an upgrade rollback
file.

### Local model thinking controls

OvertChat does not probe a local model's chat template to guess its thinking
switch. The chat thinking selector uses levels from the model catalog, or from
detection saved by earlier releases, until an administrator configures them.

For vLLM, llama.cpp, SGLang, and custom Chat Completions models, open
**Settings → Models**, edit the model, and set **Thinking → Levels** to
**Custom**. Start from a preset:

- **enable_thinking** or **thinking**: On/Off through
  `chat_template_kwargs`, for templates with a boolean switch.
- **reasoning_effort**: low, medium, and high.
- **None**: hides the thinking selector.

**Request fields** holds one JSON entry per level (`on`, `off`, `minimal`,
`low`, `medium`, `high`, `xhigh`, or `max`). OvertChat merges the chosen
level's entry into the request body as a JSON Merge Patch: objects merge,
`null` removes a field, and other values replace it. Configure both `on` and
`off`, or at least one effort level. With effort levels, `on` is offered only
when it is the default. Set **Default level** to what the server does when no
thinking field is sent; chat preselects it and marks it as the default.

For vLLM and llama.cpp, **Check with server** renders the prompt template once
per level without generating. vLLM uses its render endpoint and falls back to
`/tokenize`; llama.cpp uses `/apply-template`. The check reports levels that
render the same prompt, fields the server rejects, and which level matches a
request without thinking fields. It cannot see fields the server applies
outside the template. Custom levels survive model re-detection; select
**Automatic** to return to catalog or saved levels.

## Share with your family

Add accounts under **Settings → Users → Add user**, then share their login
details and your server's LAN or HTTPS URL. With OvertChat Cloud, the
`overtchat.app` address works for them anywhere. Everyone uses the enabled models
with their own chats and projects. Only the first account uses public signup;
administrators create subsequent accounts.

## Shared chat links

Use **Share chat** in a saved conversation to preview it and create a public
link. Anyone who can reach your server and has the link can read the snapshot
without an account, including its attachments, generated images, reasoning,
tool results, and artifacts. System instructions, provider metadata, and account
settings are excluded. Recipients cannot edit the chat or run its tools.

Later messages and edits remain private until you select **Update link**.
**Unshare** disables the link and its file URLs. Deleting the original chat or
its owner also removes the share. Web and desktop users can review and revoke
links under **Settings → Data → Shared chats**; mobile users can manage a link
from the conversation's sharing dialog. Previously downloaded copies remain
with their recipients.

Links prefer the server's configured public address (`BETTER_AUTH_URL`, set by
managed setup), including its `https://<name>.overtchat.app` address when Cloud
is configured, even when the client connects locally. Without a configured
non-loopback address, they use the client's current server address. A LAN-only
or VPN-only server remains reachable only on that network. Shared files remain
in the server's upload store while the snapshot references them, even if they
are edited out of the original chat.
Normal database and upload-directory backups include shared conversations.

Public transcripts load 50 messages per request. Updating a share replaces its
contents at the same URL; it is not a permanent citation of a specific revision.
If an update happens between pages, the reader must reload before continuing.

Public reads are limited per server process: each link permits 120 transcript
requests and 600 file requests per minute; total server budgets are 1,200 and
6,000 respectively. A rejected request returns HTTP 429 with `Retry-After`.
These budgets do not trust client-supplied forwarding headers. They are shared
by readers of a link, so very busy links may temporarily throttle everyone.
The counters reset on server restart; upstream proxy limits can provide
additional protection for large public deployments.

## Desktop

The desktop app connects to your existing OvertChat server. It does not install
the server or run models locally. First install or update the server using the
manager above, then choose your platform on the
[downloads page](https://overtchat.com/downloads/). The
[release log](https://overtchat.com/releases/) also lists archives, checksums,
and previous versions. Drafts and prereleases are not listed there.
The desktop app requires a server that reports the current API contract; older
servers cannot run it. The app checks API compatibility before loading your
chats and explains when the server or app needs updating.

The connection screen looks for OvertChat on this computer at ports 4718
(managed installations) and 4717 (source installations), plus a custom port
recorded by the local manager. Select **Connect** beside a discovered server,
or enter your server URL, then sign in with your existing account. Use
**Check again** after starting a server. Discovery does not select a server
until you click Connect, and later launches use your saved server. Servers on
other computers still require their address.

Public hostnames entered without a scheme use HTTPS. Local names such as
`localhost`, `gaming-pc`, and `server.local`, and IP addresses use HTTP unless
you specify a scheme. Enter the full `https://` or `http://` URL to override
this choice. A verified redirect from HTTP to HTTPS on the same hostname is
saved as HTTPS; changing origins signs you out.

If loading fails after connecting, use **Try again** to check the connection
again, or **Change server** to correct the saved URL. Both actions remain
available on Windows without opening the native menu. Older desktop versions
may show only “Something went wrong!”: fully quit the app, back up and rename
its `settings.json`, then reopen it and enter the correct full URL. On Windows
the file is in `%APPDATA%\overtchat`. This resets the desktop connection,
sign-in and window preferences; server-side chats are unaffected.

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
sudo apt install ./overtchat-X.Y.Z-linux-x64.deb
# Fedora instead:
sudo dnf install ./overtchat-X.Y.Z-linux-x64.rpm
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

### Windows desktop

Windows **x64** uses `overtchat-X.Y.Z-windows-x64.exe`, a per-user installer.
Windows 11 is the validated target; Windows ARM64 is not shipped. Download the
EXE from [Downloads](https://overtchat.com/downloads/) or the matching desktop
GitHub release, run it, then open **overtchat** from the Start menu. No Node.js,
Docker, or administrator privileges are needed for the desktop client.
Enter your existing server address and sign in. It does not install a server,
Host Connector, or local models.

Initial Windows builds are unsigned. SmartScreen can display **Windows protected
your PC**. Verify the download source before using **More info → Run anyway**,
if offered. Smart App Control and organization policies may block unsigned apps
entirely; use the web client when installation is blocked. Do not disable Windows
security protections to install the app.

Saved sign-in uses Windows DPAPI for the current account. Enable microphone
access for desktop apps in Windows privacy settings when using voice. Uninstall
through **Settings → Apps → Installed apps**; uninstall preserves the settings in
`%APPDATA%\overtchat` so reinstalling can restore your server and sign-in.
Sign out first if you do not want the saved session retained.

### Desktop updates

Installed macOS, Windows EXE, Linux AppImage, `.deb`, and `.rpm` builds check for desktop
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
Windows ARM64 and Linux ARM64 downloads are not yet available. Windows x64
appears on the downloads page after the first Windows desktop release is published.

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
