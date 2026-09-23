# Releases

Maintainer runbook. `apps/site/public/install-manifest.json` is the candidate
stable channel used by both `overtchat setup` and `overtchat update`.

## Rules

- Version the CLI, app, realtime voice, connector, STT, and mobile app independently.
- Publish and verify all selected artifacts before deploying the manifest.
- Use strict `X.Y.Z` versions. Never reuse a published tag or artifact.
- Managed installs do not downgrade. Roll back with a higher patch version.
- Released database changes must support forward-only upgrades; never publish
  a rollback that assumes a migration can be reversed.
- Pin bundled third-party images by digest in the manifest.

## Version map

| Component | Change | Tag |
| --- | --- | --- |
| App | Manifest `appVersion`; `compose.yml` default | `vX.Y.Z` |
| Realtime voice | Manifest `voiceVersion`; `compose.yml` default | `voice-vX.Y.Z` |
| CLI | `apps/cli/package.json`; lockfile; `CLI_VERSION`; site installer; manifest `cliVersion` | `cli-vX.Y.Z` |
| Connector | Package and lockfile; bridge release version; connector installer; site redirects; manifest `connectorVersion` | `connector-vX.Y.Z` |
| STT | Manifest `sttVersion`; `compose.yml` default | `stt-vX.Y.Z` |
| Bundled images | Manifest Redis, SearXNG, or Kokoro image digest | None |
| Mobile | See [Mobile release](#mobile-release) | `mobile-vX.Y.Z` |

Do not change unrelated manifest fields.

## Common flow

1. Make the version changes above and run validation.
2. Open the PR against `main` and squash-merge it.
3. Tag the released `main` commit with the component tag.
4. Wait for artifact publication and the serialized promotion workflow.
5. Verify `https://overtchat.com/install-manifest.json`.

## Component notes

- **App:** The app workflow publishes the amd64/arm64 image, creates the GitHub
  release, and dispatches promotion.
- **Realtime voice:** The voice workflow publishes the amd64/arm64 image and
  dispatches promotion.
- **CLI:** The CLI workflow builds and natively smoke-tests all four
  Linux/macOS binaries, publishes the GitHub release, and dispatches promotion.
- **Connector:** The connector workflow builds and natively smoke-tests all four
  Linux/macOS binaries, publishes the GitHub release, and dispatches promotion. Increment the bridge protocol only
  for a breaking web-to-connector contract change; ordinary connector releases
  retain the current protocol.
- **STT:** The STT workflow publishes both images and dispatches promotion.
- **Bundled images:** Promotion verifies amd64 and arm64 for every selected
  digest except the amd64-only Kokoro Blackwell image. Keep the CPU, standard
  CUDA, and Blackwell Kokoro digests on the same upstream release. A
  digest-only change does not require a CLI release.
- **Combined:** Artifacts may publish in any order; promotion succeeds only
  after every selected component is public.

## Mobile release

`apps/mobile/app.json` is authoritative: `expo.version` is the public version,
`android.versionCode` is the committed Play build number, and
`ios.buildNumber` mirrors it as a string. The mobile package version must match
`expo.version`. `eas.json` uses local app versions; keep remote versioning and
automatic increments disabled unless this release model is deliberately
replaced.

Android signing files and the Android Firebase push configuration are local and
gitignored at `apps/mobile/credentials.json`,
`apps/mobile/credentials/android/keystore.jks`, and
`apps/mobile/google-services.json`. A self-hosted runner supplies them from
`$HOME/.overtchat/mobile-credentials`, including `google-services.json`, because
the release workflow installs and evaluates them before the build. Retrieve a
missing local copy through EAS credentials rather than committing it.

`.github/workflows/mobile-eas.yml` owns the Android release pipeline:

1. A manual dispatch builds the production AAB and APK and smoke-tests the APK
   on a clean hosted emulator. It uploads short-lived workflow artifacts but
   does not submit to Play or create a GitHub release.
2. A tagged release performs the same build and emulator gate, submits the
   verified AAB to Play production with `releaseStatus: completed`, and
   attaches the APK to the matching GitHub release.
3. Submission therefore goes live after Google review; there is no Play draft
   gate. The service account needs the separate **Release to production** app
   permission.

The same workflow owns iOS production builds on GitHub-hosted `macos-15`
with Xcode 26.3. EAS CLI 24.4.2 runs `build --local`, so compilation uses the
GitHub runner rather than the EAS hosted-build quota. iOS production signing
uses the existing EAS-managed distribution certificate and provisioning
profile. The existing GitHub `EXPO_TOKEN` secret authenticates both build and
upload; EAS holds the App Store Connect API key for submissions. The public
App Store app ID is configured in `apps/mobile/eas.json`. No Apple password or
MacBook keychain is needed on the hosted runner.

1. Manual dispatch accepts `platform: all`, `android`, or `ios` (default `all`).
   It never uploads to either store, even when dispatched against a tag.
2. The iOS job checks committed versions, mobile types, and readable production
   Sentry settings, then builds and verifies the signed IPA: bundle ID, version,
   build number, arm64 executable, production push entitlement, and App Store
   provisioning. This is an archive check, not an iOS simulator/UI smoke test.
3. A `mobile-v*` tag builds both platforms independently. After iOS verification,
   its upload job sends that exact IPA to App Store Connect through EAS Submit
   and waits for the submission result. Failure on either platform does not
   prevent the other platform from completing.
4. After Apple processes the upload, select that build in App Store Connect,
   complete the version's release details, and submit it for App Review.
   The workflow does not change review submissions or store metadata.

To validate iOS without uploading a build:

```bash
gh workflow run mobile-eas.yml --ref <branch> -f platform=ios
```

Before a new tagged release, increment the committed Android/iOS build number
and set the intended public version. A build number already uploaded to Apple
cannot be uploaded again; a manual validation build may reuse it because it
never reaches Apple. Signed IPA workflow artifacts expire after three days.
If signing credentials expire, renew them with `eas credentials --platform ios`
from `apps/mobile` and the production profile before rerunning. Do not add PR
triggers to this credentialed workflow; PR validation runs on hosted machines
without release credentials.

Local EAS builds cannot read secret-visibility variables.
`EXPO_PUBLIC_SENTRY_DSN` must have plain-text visibility so crash reporting is
enabled in the binary; `SENTRY_AUTH_TOKEN` remains a credential but must be
readable by the local build. Keep each EAS build profile's environment explicit
and run the workflow preflight before spending time on a release build.

## Validation

Run the standard repository lint, typecheck, and test scripts, followed by the
release-specific checks below.

For an app release, build and inspect the production image that the tag workflow
will publish:

```bash
docker build --platform linux/amd64 --tag overtchat-app-release-check .
docker run --rm --entrypoint sh overtchat-app-release-check -c '
  test -f /app/apps/web/server.js
  test -d /app/apps/web/drizzle
  test ! -e /app/apps/web/data
  test ! -e /app/apps/web/scripts
'
```

For a realtime voice release, build the image and run its focused tests:

```bash
docker build --platform linux/amd64 --tag overtchat-voice-release-check voice
(cd voice && python3 -m unittest test_overtchat_runtime.py)
```

For a CLI release, build the CLI workspace and then verify the bundled version:

```bash
npm run build -w apps/cli --
node apps/cli/dist/overtchat.mjs version
```

CLI and connector assets use `linux-amd64`, `linux-arm64`, `darwin-amd64`, and
`darwin-arm64` suffixes. Release workflows run each executable's version check
on its native OS/CPU before publication. Promotion requires checksums for all
four targets. The macOS bootstrap uses the system `shasum -a 256`.

For macOS deployment changes, use a disposable Mac installation with Docker
Desktop and a logged-in desktop user. Verify setup, rerunning setup, update,
connector LaunchAgent restart, LAN/local access, and a CPU TTS/STT round trip.
Verify the standalone connector installer and its upgrade rollback as well.
Keep Apple GPU speech support separate from the CPU deployment path.

`promote-release.yml` is the only CI production deploy path. It verifies CLI
and connector checksums plus the required app/voice/STT platforms before
atomically deploying the site and manifest. After deployment, it updates the
app and voice `latest` aliases to the versions selected by `appVersion` and
`voiceVersion`; the manifest remains the stable source of truth. Versioned
container tags are immutable.
