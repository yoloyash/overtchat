# Releases

Maintainer runbook. `apps/site/public/install-manifest.json` is the candidate
stable channel used by both `overtchat setup` and `overtchat update`.

## Rules

- Version the CLI, app, realtime voice, connector, STT, mobile, and desktop apps independently.
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
| Desktop | `apps/desktop/package.json`; workspace lockfile entry | `desktop-vX.Y.Z` |

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
- **CLI:** The CLI workflow verifies Linux/macOS binaries, publishes the GitHub
  release, and dispatches promotion.
- **Apple speech:** Ships inside the CLI. Run [Apple speech validation](development.md#apple-speech)
  after changing it. The first release requires both app and CLI version bumps
  and coordinated promotion so the app supports native routing/authentication.
- **Connector:** The connector workflow verifies Linux/macOS binaries, publishes
  the GitHub release, and dispatches promotion. Increment the bridge protocol only
  for a breaking web-to-connector contract change; ordinary connector releases
  retain the current protocol. Protocol 6 adds byte-bounded batches, fragmented
  event delivery, paged history, and Codex text deltas. Release the app and
  connector together, with the connector version changes listed above and the
  managed manifest promoted only after both artifacts are available. Bundled
  desktop/mobile clients must also move to client API level 2 for sync-only
  session opens and history paging. Test the new matched versions and verify
  older mismatched versions fail with the compatibility message before promotion.
- **Desktop:** The desktop workflow creates a verified draft for a component
  tag. Follow [Desktop macOS release](#desktop-macos-release) and
  [Desktop Linux release](#desktop-linux-release) to validate and publish it;
  desktop downloads do not use manifest promotion.
- **STT:** The STT workflow builds `speech/stt/Dockerfile.cpu` and
  `speech/stt/Dockerfile.gpu` with `speech/stt/` as their context, publishes both
  images, and dispatches promotion.
- **Bundled images:** Promotion verifies amd64 and arm64 for every selected
  digest except the amd64-only Kokoro Blackwell image. Keep the CPU, standard
  CUDA, and Blackwell Kokoro digests on the same upstream release. A
  digest-only change does not require a CLI release.
- **Combined:** Artifacts may publish in any order; promotion succeeds only
  after every selected component is public. Automatic promotion (including
  release-note edits) defers while artifact downloads or image lookups are
  unavailable after retries. Checksum, installer, and platform verification
  failures remain fatal. A manual promotion with `require_complete: true` also
  fails when artifacts are unavailable.

The connector installer artifact is verified against the source at the selected
`connector-vX.Y.Z` tag. Unreleased installer changes on `main` can accumulate
until release preparation; they do not need to match the currently published
installer. A mismatch with the tagged source or a failed tag lookup blocks
promotion. Version bumps select the next candidate; tags publish its artifacts,
and stable promotion waits until all selected artifacts are available.

## Website downloads

The static site's `/downloads/` page selects installers from the newest published
stable desktop release and the optional APK from the newest stable mobile release
at build time. It uses the same GitHub release loader as `/releases/`; drafts and
prereleases are excluded. Missing required desktop DMG, deb, rpm, or AppImage
assets fail the site build instead of silently mixing versions. Store links remain
independent of GitHub mobile publication and store review timing.

The existing promotion workflow rebuilds the site on release publication, edits,
deletion, or site changes on `main`. If promotion defers for incomplete managed
artifacts, downloads remain at the last deployed snapshot until promotion succeeds.
After publishing a desktop or mobile release, verify `/downloads/` and its asset
links as well as `/releases/`. If publication uses `GITHUB_TOKEN`, explicitly
dispatch promotion as documented above; that token does not trigger release-event
workflows. The independent desktop update feed does not refresh the marketing site.

## Coordinated server and desktop launch

Merge the desktop stack before publishing server 0.23.0 and desktop 0.1.0.
Use a release-preparation PR to select `appVersion: 0.23.0` in the candidate
manifest and Compose default, verify the desktop package/lockfile version, and
add desktop downloads to the site's release log. Keep unrelated components at
their existing versions unless their release inputs changed. The public
installation guide is [Deploy: Desktop](deploy.md#desktop).

After merging preparation, keep the reviewed release commit fixed:

1. Run a trusted manual desktop build on that commit to verify hosted Developer
   ID signing and notarization. Run the final server candidate as a canary and
   verify existing web/mobile clients and the released connector.
2. Create `desktop-v0.1.0` on the reviewed commit. This creates a private draft,
   not a public release. Qualify its exact downloaded artifacts using both
   desktop sections below, including fresh installation and upgrades.
3. Only after qualification, create `v0.23.0` on the same commit. The app tag
   automatically publishes the image and GitHub release and dispatches stable
   promotion; it has no manual draft gate. Verify the published image revision,
   amd64/arm64 platforms, successful promotion, and the live install manifest.
4. Take a fresh consistent database backup and record deployment configuration
   and the current image before moving production off its canary. Wait until
   the live manifest selects 0.23.0 before running the managed update. Verify
   the actual running image, installation record, login, chat, and services.
5. Publish the qualified desktop draft with `--latest=false`. Verify the public
   assets and rebuilt site's desktop release/download entries before announcing
   the combined launch. Desktop is independent of manifest promotion, so the
   server workflow does not wait for desktop qualification automatically.

Do not move published tags or replace public assets. Keep the backup for
recovery; normal managed rollback is a new, higher patch release as described
in the rules above.

## Desktop macOS release

Public desktop installation and update instructions live in
[Deploy: Desktop](deploy.md#desktop).

The Electron desktop client has an independent version in
`apps/desktop/package.json`. Update its lockfile workspace entry with the pinned
npm before creating `desktop-vX.Y.Z`; desktop releases do not change the server
image, managed-install manifest, or mobile version.

`.github/workflows/desktop-release.yml` builds on native Apple Silicon and Intel
GitHub-hosted Macs, plus Linux x64 (see the Linux section below):

- PRs package and verify an ad-hoc app without release credentials.
- Manual dispatches build signed, notarized DMG and ZIP downloads and retain
  them as workflow artifacts for seven days. Dispatch a trusted, reviewed ref;
  it executes with signing and Apple API credentials. The workflow must first
  exist on the default branch for GitHub's manual dispatch UI to expose it.
- `desktop-v*` tags build the same downloads and create a **draft** GitHub
  release after both Mac architectures and Linux pass. The workflow downloads the uploaded
  assets again and compares their bytes and SHA-256 checksums. It does not
  publish the draft or change GitHub's Latest release.

The release configuration extends the local packaging configuration and requires
Developer ID signing, hardened runtime, and app notarization. The build script
imports the exported certificate into an isolated temporary keychain using
[GitHub's documented macOS signing setup](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications), then Electron Builder signs the nested
Electron binaries through `CSC_KEYCHAIN`. The script restores the original
keychain search list and removes its temporary keychain on exit. This avoids
the incorrect keychain password used by Electron Builder 26.15.3's `CSC_LINK`
importer. Node CLI inspection is disabled in release builds.
The app is stapled before creating the ZIP and DMG; the DMG is also submitted
and stapled separately. Verification checks the app recovered from both
downloads, bundle/version/architecture, Developer ID team, secure timestamp,
runtime entitlements, packaged files, Electron fuses, staple, and Gatekeeper.
The packaging scripts also generate updater metadata from the final downloadable
bytes, after notarization. Publishing the qualified draft triggers the
[desktop update feed](#desktop-update-feed) workflow.

### Apple credentials

Use a **Developer ID Application** certificate for team `C35DR2MHM7`, created
with the G2 authority. An iOS Apple Distribution certificate cannot sign these
downloads. Export the certificate **with its private key** as a password-protected
`.p12` from Keychain Access. Keep local private keys, exports, and their password
files outside the repository in a private directory with mode `0700`, with
private files at `0600`. Keep the bundle ID `com.overtchat.desktop` and signing
team stable across releases.

Configure these GitHub Actions repository secrets through GitHub's secrets UI
or `gh secret set` via standard input:

- `MACOS_DEVELOPER_ID_P12`: the base64-encoded `.p12`, including certificate and
  private key. Supply the encoding directly to standard input, without logging it.
- `MACOS_DEVELOPER_ID_PASSWORD`: the `.p12` export password.
- `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `ASC_API_PRIVATE_KEY`: an App Store
  Connect **team** API key with notarization access. The existing iOS upload
  key can be reused; individual API keys are not supported by this setup.

The credentialed build fails before packaging if any required secret is missing.
Private API key material is written only to a temporary private directory and
removed on exit. PRs never receive these credentials. Do not add a
`pull_request_target` signing path or run a manual build against an untrusted ref.
Renew the certificate before its actual expiry and update both `.p12` secrets
together. Do not revoke a certificate that signed public releases without
checking the consequences for those releases.

### Build and publication

After the workflow is available on the default branch, build a reviewed ref
without creating a release:

```sh
gh workflow run desktop-release.yml --ref <reviewed-ref>
```

For a release, merge the versioned commit into `main`, then create the matching
`desktop-vX.Y.Z` tag. The draft contains
`overtchat-X.Y.Z-mac-arm64.{dmg,zip}` and
`overtchat-X.Y.Z-mac-x64.{dmg,zip}`, the four Linux x64 downloads below, and
checksums for each platform/architecture, plus `stable-arm64-mac.yml`,
`stable-x64-mac.yml`, and `stable-linux.yml`.
Never move a tag or replace assets after publication. A failed build can resume
its still-unpublished draft; manual builds only upload workflow artifacts.

Before publishing, download the exact candidate and verify its checksums. On
each supported architecture, open the downloaded DMG normally, drag the app to
Applications, and launch it through Finder. Record version, architecture, and
macOS version, and check:

1. Gatekeeper accepts the downloaded app; server selection, login, and chat
   streaming work against a compatible server.
2. Approve the initial Keychain request using **Always Allow**. Completely quit
   and relaunch twice; the session restores without repeated consent. First
   access from an ad-hoc development build to a Developer ID build may ask again.
3. Microphone access, uploaded images, native menus, and Change Server work.
4. Upgrade an existing signed installation with saved settings and sign-in;
   verify data and Keychain access survive the upgrade. The first release needs
   a fresh install and a signed candidate-to-candidate upgrade test.

The build checks do not replace this UI and upgrade gate. After it passes,
publish the verified draft explicitly without changing the other components'
Latest release:

```sh
gh release edit desktop-vX.Y.Z --draft=false --latest=false
```

For local release builds, use `bash .github/scripts/package-desktop-mac.sh arm64`
(or `x64`) with the same secret names loaded into the environment through a
private local credential source. The script signs, notarizes, verifies, and
writes checksums without publishing. `npm run package:mac -w apps/desktop --`
remains the credential-free development packaging command.

## Desktop Linux release

The desktop workflow builds Linux **x64** downloads using electron-builder's
standard `AppImage`, `deb`, `rpm`, and `tar.gz` targets. It uses the same bundled
UI, desktop version, and `desktop-vX.Y.Z` tag as macOS. Windows and Linux ARM64
are not part of this release. No paid signing account is required for these
direct GitHub downloads; this workflow does not provision an APT/YUM repository.
In-app updates use the [desktop update feed](#desktop-update-feed).

The Linux job builds and verifies all four formats on PRs, manual dispatches,
and release tags, without Apple credentials. PR and manual builds retain
downloads as workflow artifacts. Tags add these assets to the verified draft:

- `overtchat-linux-x64.AppImage` (stable filename preserves shortcuts on update)
- `overtchat-X.Y.Z-linux-x64.deb`
- `overtchat-X.Y.Z-linux-x64.rpm`
- `overtchat-X.Y.Z-linux-x64.tar.gz`
- `desktop-checksums-linux-x64.txt`

The verifier checks x86-64 ELF architecture, package version, ASAR contents,
Electron fuses, package metadata, desktop entries, and all recovered bundles.
Linux Electron does not enforce embedded ASAR integrity: the configured fuse
does not provide macOS-style tamper protection on Linux. Verify the SHA-256
checksums from the release before installing downloads.

### Installation and sandbox

On Debian/Ubuntu, use `sudo apt install ./overtchat-X.Y.Z-linux-x64.deb`.
On Fedora, use `sudo dnf install ./overtchat-X.Y.Z-linux-x64.rpm`.
Launch **overtchat** from the application menu or run `overtchat-desktop` as your
regular desktop user. The package and executable use `overtchat-desktop` so they
do not conflict with the management CLI's `overtchat` command. These packages install Chromium's root-owned sandbox
helper with mode `4755`. On compatible AppArmor systems, they install a profile
allowing user namespaces for `/opt/overtchat/overtchat-desktop`; uninstall removes and
unloads the profile. Installation never disables system-wide restrictions.
The Debian dependencies include Chromium's audio library under either Ubuntu
package name. The RPM's post-transaction hook preserves the executable link
and AppArmor profile after an upgrade, including replacement of older packages
whose removal hook cleans up that integration during the transaction.

AppImage and tarball builds are portable and do not perform a privileged
installation. They require working unprivileged user/network namespaces; test
with `unshare --user --map-root-user --net true`. Ubuntu 24.04's AppArmor policy
can block these portable paths: use the `.deb` there. Do not use `--no-sandbox`
as an installation workaround. Main refuses this flag, including the generated
AppImage launcher's fallback, before creating any renderer.

To run an AppImage, make it executable with `chmod +x` and open it. We pin
electron-builder's recommended static runtime toolset `1.0.3`, which removes
the legacy FUSE 2 dependency. Where mounting is unavailable, run the AppImage
with `--appimage-extract-and-run`; this still requires a working Chromium
sandbox. For the tarball, extract it and run its `overtchat-desktop` executable as a
regular user. Portable formats do not install application-menu entries.

Saved login uses the desktop's OS secret store (GNOME Secret Service or KDE
Wallet). When no usable store exists, the session lasts until the app quits.
The `basic_text` backend is never used to persist a bearer token. Installing
an OS secret store does not migrate an in-memory session; sign in again.

### Validation before publication

CI installs, launches, and removes the `.deb` on Ubuntu 22.04 and 24.04, checks
Fedora RPM installation/removal in a container, and launches the AppImage's
extracted and extract-and-run entrypoints plus the tarball. The packaged smoke uses a local API
fixture and inspects the renderer's kernel sandbox; failure diagnostics are
retained. Both Ubuntu package checks also exercise same-PC server discovery,
custom manager ports, explicit connection, saved-server restoration, and
compatibility/retry behavior through the bundled UI. Ubuntu 22.04 also tests a
higher-version package made from the same code, retaining encrypted login through the installation. The source version
and candidate downloads are not changed. Packaging alone does not qualify a Linux release.

Download the exact candidate and verify its checksums. Record the distro,
desktop environment, package format, and app version. Before publishing:

1. Install/launch the `.deb` on Ubuntu 22.04 and 24.04, and the `.rpm` on
   Fedora. Verify application-menu icons, sandboxed launch, and clean uninstall.
2. Launch AppImage and tarball on a system with working user namespaces;
   test the AppImage itself, including its mount or extract-and-run entrypoint.
3. Against a compatible server, check server selection, login, chat streaming,
   uploaded images/downloads, external links, microphone capture/playback,
   menus, and Change Server. Check both X11 and Wayland desktop sessions.
4. Verify saved login across two full quit/relaunches with GNOME and KDE
   credential stores. Verify no token is saved when the store is unavailable.
5. Upgrade a previous installation while retaining settings and saved login.
   For the first release, use two candidate builds. Removing the package must
   leave the user's settings intact while removing installed launchers/profile.

Publish the existing desktop draft only after its macOS and Linux gates pass,
using the publication command in the macOS section. Never replace public assets
or move a published tag.

## Desktop update feed

`.github/workflows/desktop-update-feed.yml` runs when a stable `desktop-vX.Y.Z`
release is published. Drafts and prereleases do not change the public feed.
It downloads the immutable GitHub assets, verifies checksums and metadata,
and publishes the three channel YAML files under `desktop/` in Cloudflare R2
bucket `overtchat-updates`, served at `https://updates.overtchat.com`.
Installer URLs remain version-pinned GitHub release URLs; desktop publication
does not depend on server/CLI/mobile promotion or the marketing site's build.

Configure repository secrets `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and
`CLOUDFLARE_R2_PUBLIC_URL` (`https://updates.overtchat.com`). The R2 key needs
Object Read & Write for this bucket. The workflow also accepts the existing
`CLOUDFLARE_ACCOUNT_ID` repository variable. Keep the public custom domain
accessible without authentication and caching disabled for channel YAML files.
Credentials are used only by CI, never embedded in the desktop app.

Rerun failed publication with:

```sh
gh workflow run desktop-update-feed.yml --ref main -f tag=desktop-vX.Y.Z
```

Publication is serialized and conditional on the previous object ETag. Older
releases cannot overwrite newer feeds; rerunning the same version is idempotent
only if its metadata is unchanged. Fix a bad public release with a higher
desktop patch version, never by replacing its assets or repointing an older feed.
Publishing releases from another GitHub Actions workflow with its default
`GITHUB_TOKEN` does not trigger a second workflow; if replacing the human
publication step, explicitly dispatch this feed workflow too.

The updater uses `electron-updater`'s generic provider. Mac channels separate
arm64/x64; Linux's channel contains AppImage, `.deb`, and `.rpm`, selected by
the installed format. Tar installs remain manual. Channel metadata includes
`clientApiLevel`: main checks an exact match with the selected server before
downloading and again before installation. Offline checks accept only the
installed client's API level. A single stable feed does not retain an older
API-compatible release once a newer release has replaced it.

Before publishing, qualify an actual higher-version update on both signed Mac
architectures and Linux formats: discovery without downloading, clicking to
download, progress, retry after a network interruption, postponing restart,
explicit restart, saved login, and normal quit
without installation. Check both newer/older server API mismatches, switching
servers after download, and updates before sign-in. Native Linux package
updates require working privilege authentication; AppImage updates need a
writable file. The first updater release needs a manual install and two
candidate builds to qualify the restart path. Verify the public channel URLs
after publication before announcing the release.

### Qualifying the first in-app update

Use a private, lower-version build of the updater-capable code as the baseline;
the public desktop 0.1.0 predates the updater. On a temporary reviewed branch,
change only Builder's `publish.url` to `http://127.0.0.1:4931/`, then manually
dispatch `desktop-release.yml` on that branch. These workflow artifacts are
test builds; never replace the public 0.1.0 tag or assets.

Build the final higher-version candidate with the production configuration.
Download and merge its Mac and Linux workflow artifacts into a private local
directory and verify all three checksum files. Serve that directory with:

```sh
node .github/scripts/serve-desktop-update-test.mjs <candidate-directory>
```

The helper validates installer hashes and sizes, changes only the in-memory
test metadata URLs, and serves on loopback. The candidate installers retain
their exact signed release bytes and production update configuration. Run the
baseline, download and postpone the candidate, quit normally, relaunch the
baseline, then explicitly update and verify the installed version and saved
login. Add `4931 --interrupt-once` to test a failed download. Restore the fixture
with `curl -X POST http://127.0.0.1:4931/__resume`, then retry from the app.
The automated native Mac qualification uses the exact workflow artifact pair,
without rebuilding or publishing them:

```sh
gh workflow run desktop-release.yml --ref <reviewed-ref> \
  -f qualification_baseline_run=<baseline-run-id> \
  -f qualification_candidate_run=<candidate-run-id>
```

It checks discovery without download, both server API mismatches, interrupted
download/retry, a server becoming incompatible after download, normal quit
without installation, a real Squirrel install/relaunch, and encrypted login
retention on native arm64 and x64 runners. These jobs need read-only repository
and artifact access; they receive no signing or Cloudflare secrets. They use
an isolated, unlocked test Keychain containing only a generated encryption key
for the test app, then restore the runner's original Keychain configuration.
Use a writable test app location. Close an existing Mac instance and back up
its profile before testing; restore it afterward. Linux tests can isolate the
profile with `XDG_CONFIG_HOME`; use a dedicated test user with no existing
desktop instance. Verify AppImage replacement and native package
authentication separately. After qualification, publish the exact reviewed
candidate and verify the public R2 feed workflow.

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

The root `.easignore` preserves the root and mobile Git exclusions but includes
`apps/mobile/google-services.json` in the EAS build archive. Keep these exclusions
in sync when changing either `.gitignore`; EAS ignores both files when
`.easignore` exists. Signing credentials and service account keys remain excluded.
The Android `eas-build-pre-install` hook validates Firebase configuration again
inside the extracted archive for preview and production builds. The release
workflow also checks the finished APK's Firebase resources against the supplied
configuration before uploading artifacts. A successful checkout-level check
alone does not prove the file reached the native build.

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
profile. The GitHub `EXPO_TOKEN` secret authenticates the build and signing
credential download. Uploads go directly to Apple from the same Mac using
Xcode's `altool`; iOS releases do not use EAS Submit or its queue.

Configure these GitHub Actions repository secrets for uploads:

- `ASC_API_KEY_ID`: the App Store Connect team API key ID.
- `ASC_API_ISSUER_ID`: the key's issuer ID.
- `ASC_API_PRIVATE_KEY`: the complete `.p8` private key, including PEM headers
  and newlines. Supply it through GitHub's secrets UI or `gh secret set` via
  standard input; never commit it or put it in command-line arguments.

An existing App Store Connect API key can be reused if it has permission to
upload builds for OvertChat. The upload script writes the key to a temporary,
private directory and removes it on exit; the hosted runner is also disposable.
No Apple password or personal MacBook keychain is needed.

1. Manual dispatch with `platform: all`, `android`, or `ios` (default `all`)
   only builds and validates, even when dispatched against a tag. The explicit
   `platform: ios-release` option builds, verifies, and uploads only iOS.
2. The iOS job checks committed versions, mobile types, and readable production
   Sentry settings, then builds and verifies the signed IPA: bundle ID, version,
   build number, arm64 executable, production push entitlement, App Store
   provisioning, and required ExpoModulesCore symbols in the shipped arm64
   binaries. These archive checks do not replace device/UI smoke testing.
3. A `mobile-v*` tag builds both platforms independently. After iOS verification,
   the Mac uploads that exact IPA directly to App Store Connect and waits for
   delivery, with a 30-minute upload timeout. Apple processing happens afterward.
   iOS jobs are serialized across refs to avoid overlapping uploads. Failure on
   either platform does not prevent the other platform from completing.
4. After Apple processes the upload, select that build in App Store Connect,
   complete the version's release details, and submit it for App Review.
   The workflow does not change review submissions or store metadata.

Before submitting to App Review, install the exact uploaded build through
TestFlight on a physical device running the latest public iOS. Check cold launch,
server selection, login, chat streaming, background/resume, and camera/QR access.
Cover a fresh installation and an upgrade with saved settings; also test iPad
because the app supports tablets. Record the version, build, device, and OS in
the release validation notes. Archive verification and Expo Go testing do not
replace this gate.

Keep Expo and its native modules aligned with the selected SDK's recommended
versions (`npx expo install --fix` from `apps/mobile`), and commit the lockfile.
PR and release workflows enforce `npm run check:native-deps -w apps/mobile --`.
The IPA gate checks actual ExpoModulesCore imports/exports because individually
valid package versions can still contain incompatible precompiled frameworks.

For a launch-crash rejection, collect the rejected build's device crash report
before rebuilding. A `DYLD` / `Symbol missing` termination happens before
JavaScript crash reporting can initialize. Fix the native build, increment the
committed shared Android/iOS build number, and repeat the TestFlight gate.
Correct the App Store Connect version label to match the intended public
version and select the verified replacement build before resubmitting. Do not
reuse an uploaded build number or move an existing mobile release tag.
See Apple's [rejected-submission procedure](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/manage-a-submission-with-unresolved-issues)
and Expo's [SDK upgrade procedure](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).

The iOS app declares `ios.config.usesNonExemptEncryption: false` in
`apps/mobile/app.json`. Expo writes `ITSAppUsesNonExemptEncryption = false`
into the built Info.plist so future uploads do not require the repeated
encryption questionnaire. This reflects the current use of Apple-provided
networking encryption and Keychain storage through SecureStore; reassess the
declaration if the app adds its own encryption implementation. It applies only
to newly built archives. For an earlier upload without this declaration, answer
the export-compliance questions in App Store Connect; no rebuild is needed just
to supply that answer. See [Expo's encryption prompt guidance](https://docs.expo.dev/versions/latest/sdk/securestore/#exempting-encryption-prompt).

To validate iOS without uploading a build:

```bash
gh workflow run mobile-eas.yml --ref <branch> -f platform=ios
```

To rebuild and upload iOS from a trusted release commit or reviewed branch
without creating another tag or releasing Android:

```bash
gh workflow run mobile-eas.yml --ref <ref> -f platform=ios-release
```

This uploads to App Store Connect; it does not submit for App Review. Before
recovery from a failed or timed-out upload, check App Store Connect's TestFlight
builds and any earlier EAS submission. Cancel a queued EAS submission and confirm
it is canceled before switching upload paths. Reuse the committed build number
only if Apple has not received it; otherwise increment the shared Android/iOS
build number. Do not move an existing release tag. Rerunning an old GitHub run
uses its original workflow, so dispatch the revised workflow ref explicitly.

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

The CLI release workflow also gates publication on the real compiled CLI and
piped installer running in a pseudo-terminal on Linux/macOS, x86-64/arm64.
The test uses arrow keys and Enter to select home network access, customize the
port and LAN address, and submit empty additional addresses. It then sends
Escape at the services prompt, requiring exit 130 and no provisioning. It uses
an isolated home, a local candidate manifest, staged downloads, and a Docker stub;
it does not exercise container startup or service provisioning. Run it locally
with a binary compiled for your host (the version must match the manifest):

```sh
python3 .github/scripts/cli-installer-pty-smoke.py \
  apps/site/public/install /path/to/overtchat-darwin-arm64 darwin-arm64
```

`promote-release.yml` is the only CI production deploy path. It verifies CLI
and connector checksums for Linux/macOS on x86-64/arm64, plus the required
app/voice/STT platforms, before atomically deploying the site and manifest.
After deployment, it updates the app and voice `latest` aliases to the versions selected by `appVersion` and
`voiceVersion`; the manifest remains the stable source of truth. Versioned
container tags are immutable.
