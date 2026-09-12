# Deploy

Requires x86-64 or arm64 Linux. The guided manager installs and updates
OvertChat with Docker Compose.

## Install

```sh
curl -fsSL https://overtchat.com/install | sh
```

Choose where to access OvertChat, local search, speech, and voice services,
and whether to check for updates. The wizard installs Docker if needed and
generates the configuration and secrets; no `.env` file editing is needed.
Open the printed URL, create the administrator account,
and add your model endpoint in the web app.

```sh
overtchat setup     # change access, services, or update notifications
overtchat status    # check versions and service status
overtchat update    # update the managed stack
```

Voice requires both STT and TTS. Bundled Parakeet and Kokoro can each use CPU or
NVIDIA GPU; setup can install NVIDIA Container Toolkit on supported systems.
Kokoro needs roughly 3–4 GB VRAM, so choose CPU if GPU memory is limited.

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

The current Linux user needs permission to manage Tailscale Serve. If needed,
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

Coding-agent executables and credentials belong on the Host Connector machine
or selected SSH host. Configure connections on the web before using them on
Android.

## Share with your family

Add accounts under **Settings → Users → Add user**, then share their login
details and your server's LAN or HTTPS URL. Everyone uses the enabled models
with their own chats and projects. Only the first account uses public signup;
administrators create subsequent accounts.

## Android

Install from [Google Play](https://play.google.com/store/apps/details?id=com.overtchat.mobile),
enter your server URL, and sign in. Use an address reachable from the phone;
`localhost` refers to the phone itself.

### Sideload an APK

1. Open [Releases](https://github.com/yoloyash/overtchat/releases) and choose the
   newest **`mobile-v*`** release (`v*` releases are for the server).
2. Download and open `overtchat-v<version>.apk`. Allow installation from your
   browser or file manager if prompted.

Repeat for updates; sideloaded builds do not auto-update.

## Update or adopt an existing installation

`overtchat update` updates the CLI, app, selected services, and managed
connector while preserving data. Rerun it if interrupted.

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

## Logs and backup

```sh
docker logs -f overtchat-app
docker logs -f overtchat-voice  # when installed

# Snapshot the live database and copy it to the host
docker exec overtchat-app sqlite3 /app/data/chat.db ".backup /app/data/backup.db"
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
