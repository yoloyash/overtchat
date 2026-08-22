#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?usage: android-release-smoke.sh <apk-path> [diagnostics-directory]}"
DIAGNOSTICS_DIR="${2:-dist/mobile/smoke-diagnostics}"
PACKAGE_NAME="com.overtchat.mobile"
UI_DUMP_DEVICE_PATH="/sdcard/overtchat-window.xml"

mkdir -p "$DIAGNOSTICS_DIR"

capture_diagnostics() {
  adb exec-out screencap -p > "$DIAGNOSTICS_DIR/screenshot.png" 2>/dev/null || true
  adb logcat -d > "$DIAGNOSTICS_DIR/logcat.txt" 2>/dev/null || true
  adb shell dumpsys activity activities > "$DIAGNOSTICS_DIR/activities.txt" 2>/dev/null || true
  adb shell uiautomator dump "$UI_DUMP_DEVICE_PATH" >/dev/null 2>&1 || true
  adb pull "$UI_DUMP_DEVICE_PATH" "$DIAGNOSTICS_DIR/window.xml" >/dev/null 2>&1 || true
}
trap capture_diagnostics EXIT

test -f "$APK_PATH"
adb logcat -c
adb install --no-streaming -r "$APK_PATH"
adb shell am force-stop "$PACKAGE_NAME"

LAUNCH_OUTPUT="$(adb shell monkey \
  -p "$PACKAGE_NAME" \
  -c android.intent.category.LAUNCHER \
  1 2>&1)"
printf '%s\n' "$LAUNCH_OUTPUT"
grep -Fq "Events injected: 1" <<< "$LAUNCH_OUTPUT"

for attempt in {1..30}; do
  if adb shell pidof "$PACKAGE_NAME" >/dev/null 2>&1 && \
    adb shell dumpsys activity activities | grep -Fq "$PACKAGE_NAME"; then
    break
  fi

  if (( attempt == 30 )); then
    echo "The OvertChat process did not reach a resumed activity." >&2
    exit 1
  fi
  sleep 1
done

for attempt in {1..30}; do
  adb shell uiautomator dump "$UI_DUMP_DEVICE_PATH" >/dev/null 2>&1 || true
  adb pull "$UI_DUMP_DEVICE_PATH" "$DIAGNOSTICS_DIR/window.xml" >/dev/null 2>&1 || true

  if grep -Fq "Get started" "$DIAGNOSTICS_DIR/window.xml" 2>/dev/null; then
    echo "Production APK launched and rendered the OvertChat welcome screen."
    exit 0
  fi

  if ! adb shell pidof "$PACKAGE_NAME" >/dev/null 2>&1; then
    echo "The OvertChat process exited before rendering its welcome screen." >&2
    exit 1
  fi
  sleep 1
done

echo "The OvertChat welcome screen did not render within 30 seconds." >&2
exit 1
