#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?usage: android-release-smoke.sh <apk-path> [diagnostics-directory]}"
DIAGNOSTICS_DIR="${2:-dist/mobile/smoke-diagnostics}"
PACKAGE_NAME="com.overtchat.mobile"
MAIN_ACTIVITY="$PACKAGE_NAME/.MainActivity"
READY_TEST_ID="welcome-get-started"
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

dismiss_launcher_anr() {
  local windows
  windows="$(adb shell dumpsys window windows 2>/dev/null || true)"
  if grep -Fq "Application Not Responding: com.android.launcher3" <<< "$windows"; then
    echo "Dismissing an Android emulator launcher ANR."
    adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
    sleep 1
  fi
}

wait_for_android_idle() {
  adb wait-for-device

  # sys.boot_completed can become true before Launcher3 and package broadcasts
  # have settled. Suppress dialogs only while Android-owned boot work finishes,
  # then restore them so an OvertChat crash or ANR remains visible and fatal.
  adb shell settings put global hide_error_dialogs 1
  timeout 60 adb shell am wait-for-broadcast-idle >/dev/null
  sleep 5
  dismiss_launcher_anr
  adb shell settings put global hide_error_dialogs 0
}

welcome_screen_is_visible() {
  grep -Eq \
    "resource-id=\"([^\"]*:id/)?${READY_TEST_ID}\"" \
    "$DIAGNOSTICS_DIR/window.xml" 2>/dev/null
}

test -f "$APK_PATH"
wait_for_android_idle
adb logcat -c
adb install --no-streaming -r "$APK_PATH"

LAUNCH_OUTPUT="$(adb shell am start -W -S -n "$MAIN_ACTIVITY" 2>&1)"
printf '%s\n' "$LAUNCH_OUTPUT"
grep -Fq "Status: ok" <<< "$LAUNCH_OUTPUT"
grep -Fq "Activity: $MAIN_ACTIVITY" <<< "$LAUNCH_OUTPUT"

for attempt in {1..30}; do
  RESUMED_ACTIVITY="$(
    adb shell dumpsys activity activities 2>/dev/null \
      | grep -F "topResumedActivity=" \
      | head -n 1 \
      || true
  )"
  if adb shell pidof "$PACKAGE_NAME" >/dev/null 2>&1 && \
    grep -Fq "$MAIN_ACTIVITY" <<< "$RESUMED_ACTIVITY"; then
    break
  fi

  if (( attempt == 30 )); then
    echo "The OvertChat process did not reach a resumed activity." >&2
    exit 1
  fi
  sleep 1
done

for attempt in {1..30}; do
  dismiss_launcher_anr
  adb shell uiautomator dump "$UI_DUMP_DEVICE_PATH" >/dev/null 2>&1 || true
  adb pull "$UI_DUMP_DEVICE_PATH" "$DIAGNOSTICS_DIR/window.xml" >/dev/null 2>&1 || true

  if welcome_screen_is_visible; then
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
