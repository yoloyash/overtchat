# Deploy

Requires x86-64 or arm64 Linux. The guided manager installs and updates
OvertChat with Docker Compose.

## Install

```sh
curl -fsSL https://overtchat.com/install | sh
```

Choose local search, speech, and voice services in the wizard. It installs
Docker if needed. Open the printed URL, create the administrator account,
and add your model endpoint in the web app.

```sh
overtchat setup     # change services, URL, port, or Agent Connections
overtchat status    # check versions and service status
overtchat update    # update the managed stack
```

Voice requires both STT and TTS. Bundled Parakeet and Kokoro can each use CPU or
NVIDIA GPU; setup can install NVIDIA Container Toolkit on supported systems.
Kokoro needs roughly 3–4 GB VRAM, so choose CPU if GPU memory is limited.

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
connector while preserving data. Rerun it if interrupted. To disable update
notifications, run `DISABLE_UPDATE_CHECK=true overtchat setup` once.

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

[Development setup](development.md) · [Release process](release.md)
