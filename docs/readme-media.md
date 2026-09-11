# README screenshots

Run captures when you want to refresh the README, review the images, then
commit the PNGs with any fixture changes. Temporary builds and logs stay in
the ignored `.readme-media/` directory.

## Web

Use Node 22 and npm 10.9.8. On a fresh Linux machine, install browser libraries:

```sh
npm ci
npx playwright install --with-deps chromium
```

Regenerate with:

```sh
npm run media:generate
```

This builds the current source in an isolated workspace, creates a demo
database, and captures the real app with Playwright. It replaces six PNGs in
`.github/assets/`. Your running installation and database are untouched.
Dependency installation and the font build need network access; captures need
no live model, speech provider, or agent.

## Android

Requires ADB, Java 17+, `curl`, and `unzip`. Connect and unlock a demo device;
sign out of any non-demo account first. The runner installs the APK, selects
the demo server/account and dark theme, and leaves the app on that account.
It downloads Maestro 2.10.0 with a verified checksum and analytics disabled.

```sh
# Terminal 1: leave the isolated demo server running
npm run media:serve

# Terminal 2: use the serial from adb devices -l
MEDIA_ANDROID_DEVICE=your-device-serial npm run media:android
```

By default, the runner downloads the release APK matching `apps/mobile/app.json`.
For native UI changes, [build the current APK](release.md) and pass its path
with `MEDIA_ANDROID_APK=/absolute/path/to/app.apk`.

The flow replaces `android-chat.png` and `android-projects.png`. It temporarily
normalizes the status bar, extends the screen timeout, and uses `adb reverse`;
these settings are restored on exit. Stop `media:serve` with Ctrl-C afterward.

## Change the scenes

- `apps/web/media/fixtures.ts` and `conversation.json`: shared demo content.
- `apps/web/media/capture.spec.ts`: browser navigation and capture assertions.
- `apps/web/media/presentation.html`: shared frame and wordmark.
- `apps/mobile/media/capture.yaml`: native navigation and screenshots.

The main conversation is a saved local-model response. Other scenes use sample
data; browser voice and agent transports are simulated. Edit the fixtures and
expected text together. Regeneration replays this content rather than making
new model requests.
Demo timestamps use the capture date so history labels stay current.

Review image crops, readable text, dark theme, and visible controls before
committing. Use the same browser environment and Android device for consistent
rendering; exact pixels can vary across platforms.

For failures, inspect `.readme-media/server.log`,
`.readme-media/candidate/test-results/`, or `.readme-media/android/capture/`.
A stale `.readme-media/lock` can be removed after confirming its recorded PID
is no longer running. If a forced kill leaves Android in demo mode, broadcast
`com.android.systemui.demo` with `command=exit`, restore the screen timeout in
Android settings, and remove `adb reverse tcp:4799`.
