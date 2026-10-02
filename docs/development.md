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
| `npm run dev:desktop` | Electron client, with the web UI hot-reloaded from source |
| `npm run dev:site` | Public site |
| `npm run dev:reset-connector` | Reset an incompatible disposable connector journal |
| `npm run dev:managed` | Exercise production provisioning from the worktree |
| `OVERTCHAT_DEV_PORT` | Override the web port |
| `OVERTCHAT_DEV_REDIS_PORT` | Override the development Redis port |

Chat generation runs on the server. SQLite persists its status and completed
messages; Redis buffers live events for reconnecting clients. Without Redis,
generations still complete and clients recover saved messages, but cannot
replay missed live deltas.

## Dependency updates

Use the pinned npm 10.9.8 for dependency changes, including Dependabot PRs.
After updating dependencies, regenerate the lockfile from the repository root:

```sh
npm run deps:lockfile
```

This uses npm's resolver to regenerate `package-lock.json` without installing
packages or running lifecycle scripts. Review the diff for unrelated version,
integrity, or dependency changes and commit the generated lockfile. Avoid
hand-editing dependency flags or adding overrides just to repair lockfile metadata.

The Validate workflow regenerates the lockfile with the pinned npm and fails if
it changes. `npm ci` alone does not detect all dependency-flag drift. Run
`npm ci`, `npm run deps:check`, and the affected workspace checks after regeneration.

## Model catalog refresh

The weekday `Refresh model catalog` workflow fetches models.dev, validates the
generated catalog and manifest, and opens or updates `automation/model-catalog`.
To run the same validation locally:

```sh
npm run catalog:generate
npm run catalog:check
npm run test -w apps/web -- \
  lib/providers/server/model-catalog-artifacts.test.ts \
  lib/providers/server/model-catalog.test.ts \
  lib/providers/server/model-cost.test.ts
```

Commit both generated artifacts together. Lookup and cost arithmetic tests use
`model-catalog.fixture.ts` for fixed inputs; do not regenerate this fixture or
assert fixed provider prices or limits against the changing catalog. The artifact
tests exercise the actual generated catalog, including pricing compatibility for
every priced model. A legitimate upstream price change should produce a catalog
diff for review without failing a test that expects yesterday's prices.

## Chat compaction validation

Regular chat automatically compacts at 80% of the resolved model context window,
or earlier to leave room for an explicitly configured output limit and 10%
headroom. Ordinary replies keep their existing output settings: compaction adds
no reply cap. When no output limit is configured, the budget reserves an estimated
10% of the window (bounded by the model's known output maximum); this is not a
guarantee about an unknown provider default. Summary generation alone is capped
at up to 4,096 tokens, a quarter of the window, and the model's output maximum.
The Advanced context-window override controls this budget. Checkpoints live in
message metadata; the original transcript remains intact. Token counts use a local tokenizer estimate calibrated with provider
usage, including tool schemas and media allowances. `/compact` forces a checkpoint
below the threshold without generating a chat answer; it retains the newest turn
and shows a permanent inline marker. Failed summaries stop the operation with a
retryable error and leave the prior checkpoint and transcript intact. The recent
turns have a retention target of 40% of the input budget; the newest turn is
always kept. Unknown model windows leave ordinary chat available without automatic
compaction;
set a window in Advanced to enable compaction. Existing checkpoints remain in
the model context when switching to a model with an unknown window.

Run the focused regressions with:

```sh
npm run test -w apps/web -- lib/chat/compaction.test.ts app/api/chat/route.test.ts lib/db/chatTurns.test.ts
E2E_PORT=4727 npm run test:e2e -w apps/web -- compaction.spec.ts
```

The browser regression uses a controlled provider and a real HTTP MCP connection
through the production chat route. It checks large tool results across successive
agent steps, call/result pairing, unchanged reply settings, complete stored results,
and a durable inline marker. On a native device or emulator, also check `/compact`,
automatic compaction, Stop during summarization, and reopening the saved chat.

For live validation, use a disposable chat and a copy of a local model config
with tool calling disabled, so memory/tool side effects cannot influence the
recall check. Import a synthetic transcript larger than its input budget, with
known facts near the beginning and several recent turns. Ask for those facts,
verify a compaction notice and checkpoint, then continue to verify reuse. Add
more history to trigger another compaction. Test an 8k context override and an
edit before the checkpoint; the edited conversation must not reuse the old
summary. Verify `/compact` below the threshold, reload its marker, and continue
from its saved checkpoint. Verify failed and cancelled compactions do not save a
replacement checkpoint. Remove the test chat and model config afterward.

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
For navigation changes, check the shared drawer from regular and agent chats,
the remembered Agents section expansion, recent agent selection, workspace
chat creation, and opening both chat types from push notifications. Check native
Back alongside the conversation menu, edge-only drawer swipes on chat and agent
list screens, and horizontal tool/code scrolling on agent detail screens.

## Desktop validation

The desktop app needs a server at its API level, so run one from the same
worktree, e.g. `npm run dev:web`, and connect to it from `npm run dev:desktop`.
Development builds keep their server, sign-in, and window state in an
`overtchat-dev` profile, separate from installed builds.

```sh
npm run typecheck -w apps/desktop --
npm run build -w apps/desktop --
```

`npm run start -w apps/desktop --` runs the production build. Check connecting
(including an outdated server and a wrong address), signing in and out, chat
streaming, uploaded images, the menu commands, Change Server, zoom, fullscreen,
and the macOS titlebar with the sidebar open and collapsed.

On a Mac, package a local application with:

```sh
npm run package:mac -w apps/desktop --
```

Open `apps/desktop/release/mac-arm64/overtchat.app` on Apple Silicon, or
`apps/desktop/release/mac/overtchat.app` on Intel. The command builds for the
current Mac's architecture; append `--arm64` or `--x64` to select one explicitly.
It uses ad-hoc signing without notarization or publishing. The shared
`electron-builder.yml` defines the bundle identity, packaged files, icon, and
microphone permissions for future release builds.

Packaged builds use the `overtchat` profile, separate from `overtchat-dev`.
Launch the `.app` normally and approve its macOS Keychain prompt to test saved
sign-in. A command-line test process may be unable to show that prompt, and
ad-hoc rebuilds can request access again. Public releases need a consistent
Developer ID signing identity.
Repeat the checks above in the `.app`, including sign-in across a full quit and
relaunch, microphone access, and loading images from the selected server.
Local packaging does not produce a publicly distributable, notarized release.

## Speech

Speech failures distinguish disabled or missing configuration from an unreachable
provider, timeout, rejected credentials, rate limiting, and invalid responses.
The proxy returns a public message and stable `code`; clients must not infer
configuration state from HTTP 503. Provider response bodies stay out of public
errors. Web and mobile share code-to-message mapping in `packages/shared/src/errors.ts`.
The API boundary accepts known codes and the documented `{ error: string }`
public message field. Endpoints own that display copy; do not put raw provider
bodies there. Unknown codes, malformed responses, and unclassified exceptions
use the operation's fallback. Only normalized `ApiError` messages are displayed
from exceptions. Do not diagnose failures by parsing their
message text. Notice and toast strings are display copy supplied by the caller.

Use the web/native `ErrorNotice` beside failed operations that need recovery;
keep field validation beside its field and use existing toasts for brief action
feedback. Actions belong to the operation: dictation records again because failed
recordings are discarded, playback can retry, and agent commands must not be
automatically replayed when their outcome is unknown. Keep operator setup commands
in settings and deployment help.

Validate speech error handling with:

```sh
npm run test -w apps/web -- lib/errors.test.ts lib/speech/proxy.test.ts
npm run test -w apps/mobile --
E2E_PORT=4729 npm run test:e2e -w apps/web -- error-feedback.spec.ts speech-services.spec.ts voice.spec.ts
```

The browser regression uses a local fake provider and recorder to exercise real
proxy failures, draft preservation, dismissal, and recovery at desktop/mobile
viewport sizes. Also check microphone permissions and playback on native devices
when changing their platform audio hooks.

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

## Hermes ACP validation

Hermes uses `@agentclientprotocol/sdk` 0.17.1, which retains the ACP model
catalog and `session/set_model` API implemented by Hermes. Keep the SDK pinned;
an SDK upgrade must verify those APIs against the supported Hermes release.
Live validation has covered Hermes `0.21.5+2372.g678a476`.

```sh
npm run test -w packages/agent-runtime -- src/acp/client.test.ts
RUN_HERMES_INTEGRATION=1 HERMES_SSH_ALIAS=home-server npm run test -w apps/connector -- src/hermes.integration.test.ts
```

Omit `HERMES_SSH_ALIAS` to test locally; `HERMES_COMMAND` overrides the executable.
The opt-in test uses the host's configured model credentials for a small
conversation, creates a disposable workspace, and checks discovery, streaming,
cancel-and-restart steering during a harmless sleep tool, process cleanup and
persisted history after restart. It selects Don't Ask only in its disposable
session. It deletes only its own test session and workspace. Unit tests use the
actual ACP SDK with an in-memory stdio agent to cover approvals, cancellation,
history, tool projection and
replacement-turn approval, image steering and cancellation ordering. Runtime
queue tests also cover cancellation failures before a replacement is sent.
Also run the bridge/runtime/connector tests and typechecks, connector build,
web typecheck/lint/build and mobile typecheck/tests. In the running app, check
Hermes discovery, model selection, tool approval choices, Stop and reopening
the conversation over SSH.

## Library benchmark

Run `npm run bench:library -w apps/web --` without competing builds or tests.
It uses a disposable database with production migrations and synthetic
histories, ignoring `DATABASE_URL`. Results cover 2,000–200,000 messages and
two message sizes, with median and maximum query times across seven warm runs.
HTTP, rendering, concurrent users, and cold caches are excluded.

## README assets

See [README media](readme-media.md) for capture commands, shared fixtures,
and image review.

## Management CLI validation

```sh
npm run test -w apps/cli --
npm run typecheck -w apps/cli --
npm run lint -w apps/cli --
npm run build -w apps/cli --
```

Use a disposable installation when testing setup or update. Changing only
`OVERTCHAT_CONFIG_DIR` and `OVERTCHAT_STACK_DIR` does not isolate Docker
containers, data volumes, or the host connector.

Exercise command help, bare version compatibility, status/version JSON, logs,
and `update --check`. Check reporting with Docker unavailable and stopped
components. Verify that update checks do not require Docker, read credentials,
self-update, or write installation files. Setup and update retain their existing
provisioning behavior; setup dry runs still write preview files and an installation log.

Connector installation failures should finish setup/update with a visible pending
warning, preserve the agent selection, commit successful app/speech changes, and
retry on the next run. Cover fresh setup, updates, unavailable service prerequisites,
interactive retry/skip, and unattended runs. Confirm `logs install` and `logs connector`
work before installation state exists and that diagnostics exclude credentials.
Verify CLI self-update preserves terminal stdin. Connector recovery tests must show
that offline SSH hosts do not delay the channel, new launches await target recovery,
and shutdown cancels probes before releasing the journal's instance lock.

Installer binary and terminal checks are documented in [Release process](release.md).
