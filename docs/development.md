# Development

Use Node 22 and npm 10.9.8. From the repository root:

```sh
npm install
npm run dev
```

Open [localhost:4717](http://localhost:4717). This starts the web app, an isolated
Redis container, and a source Host Connector. Ctrl-C stops web and connector
processes; `npm run dev:down` stops the retained Redis container. Disposable
connector state lives in `.overtchat-dev/`, separate from production.

## Environment and commands

Development runs with checked-in defaults; copying `.env.example` is optional.
That file is a reference for manual source configuration. Managed installations
use `overtchat setup`, which generates their environment separately.

Defaults are in `apps/web/.env.development`; machine-specific values belong in
`apps/web/.env.local`. The root `.env` configures source development;
`apps/web/.env` must remain a symlink to `../../.env`. For another development
origin, configure `EXTRA_TRUSTED_ORIGINS` and Next.js `allowedDevOrigins`.

| Command or variable | Purpose |
| --- | --- |
| `npm run dev:web` | Web only |
| `npm run dev:mobile` | Expo client |
| `npm run dev:site` | Public site |
| `npm run dev:reset-connector` | Reset an incompatible disposable connector journal |
| `npm run dev:managed` | Exercise production provisioning from the worktree |
| `OVERTCHAT_DEV_PORT` | Override the web port |
| `OVERTCHAT_DEV_REDIS_PORT` | Override the development Redis port |

Chat generation runs on the server. SQLite persists its status and completed
messages; Redis buffers live events for reconnecting clients. Without Redis,
generations still complete and clients recover saved messages, but cannot
replay missed live deltas.

## Mobile validation

For Agent Connections changes:

```sh
npm run typecheck -w apps/mobile --
npm run test -w apps/mobile --
```

Run affected web and bridge checks when shared projections or replicas change.
To validate both native bundles without publishing, run from `apps/mobile`:

```sh
npx expo export --platform android --platform ios --output-dir /tmp/overtchat-mobile-export
```

On Android and iOS, check session creation/resume, web/mobile switching,
background and network recovery, model/permission controls, commands,
approvals/questions, image input, tool output, keyboard clearance, and back
gestures. Use an existing development client unless native modules change.

## Speech

`speech/stt/` contains CPU/CUDA STT containers; `speech/apple/` contains native
Kokoro/PyTorch MPS and Parakeet/MLX inference. Container TTS uses upstream Kokoro
images. Realtime orchestration remains in `voice/`.

Build STT with `docker compose --profile stt build stt-cpu` or
`docker compose --profile stt-gpu build stt-gpu`.

### Apple speech

After changing the server or lockfile, regenerate the payload embedded in the
CLI; no runtime checkout or separate speech release artifact is required:

```sh
npm run speech:bundle
npm run speech:check
npm run test -w apps/cli --
npm run test -w apps/web -- lib/speech/proxy.test.ts
python3 -m venv /tmp/overtchat-speech-tests
/tmp/overtchat-speech-tests/bin/pip install -r speech/apple/requirements-test.txt
/tmp/overtchat-speech-tests/bin/python -m unittest discover -s speech/apple -p 'test_*.py'
```

The Python tests use fake inference and real FFmpeg, including an M4A seeking
regression. Regenerate dependencies on an Apple Silicon Mac using uv 0.12.18:

```sh
MACOSX_DEPLOYMENT_TARGET=14.0 uv pip compile speech/apple/requirements.in \
  --python-version 3.12 --python-platform aarch64-apple-darwin \
  --generate-hashes --output-file speech/apple/requirements.lock
npm run speech:bundle
```

On an isolated, logged-in Apple Silicon Mac, run `speech/apple/smoke.py` with
the managed runtime's Python and its private `service.json` path. Use
`--fixture spoken.wav` for an independent recording containing "the quick brown
fox". Never print or commit the service token. Verify Docker connectivity,
long recordings, setup/update recovery, CPU switching, and restart at login.
Linux tests cover transport/codecs; physical Mac tests cover inference.

## OpenCode process lifecycle validation

The connector owns cleanup for local and SSH OpenCode servers. To exercise real
session cancellation, shared server leases, failed SSH cleanup retries, and
recovery after killing a test connector, run:

```sh
RUN_OPENCODE_LIFECYCLE_INTEGRATION=1 npm run test -w apps/connector -- src/opencode-lifecycle.integration.test.ts
```

Set `OPENCODE_COMMAND` if the local executable is not `opencode`. Set
`OPENCODE_SSH_ALIASES=linux-host,mac-host` to include configured OpenSSH aliases;
each remote login environment must provide `opencode`. These tests create and
remove disposable workspaces, sessions, and process records. They run a native
shell tool without making model requests and only terminate helpers they own.

## Library benchmark

Run `npm run bench:library -w apps/web --` without competing builds or tests.
It uses a disposable database with production migrations and synthetic
histories, ignoring `DATABASE_URL`. Results cover 2,000–200,000 messages and
two message sizes, with median and maximum query times across seven warm runs.
HTTP, rendering, concurrent users, and cold caches are excluded.

## README assets

See [README media](readme-media.md) for capture commands, shared fixtures,
and image review.
