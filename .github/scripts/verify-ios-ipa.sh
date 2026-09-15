#!/usr/bin/env bash
# Run on macOS after an EAS production build, before publishing its artifact.
set -euo pipefail

IPA="${1:?Usage: verify-ios-ipa.sh path/to/app.ipa}"
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT
unzip -q "$IPA" -d "$VERIFY_DIR"
APPS=("$VERIFY_DIR"/Payload/*.app)
test "${#APPS[@]}" -eq 1
APP="${APPS[0]}"
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP" > "$VERIFY_DIR/entitlements.plist" 2>/dev/null
security cms -D -i "$APP/embedded.mobileprovision" > "$VERIFY_DIR/profile.plist"

python3 - "$APP" "$VERIFY_DIR" <<'PY'
import datetime
import json
import pathlib
import plistlib
import subprocess
import sys

app, directory = map(pathlib.Path, sys.argv[1:])
with open('apps/mobile/app.json') as file:
    expo = json.load(file)['expo']

def plist(path):
    with open(path, 'rb') as file:
        return plistlib.load(file)

info = plist(app / 'Info.plist')
entitlements = plist(directory / 'entitlements.plist')
profile = plist(directory / 'profile.plist')
assert info['CFBundleIdentifier'] == expo['ios']['bundleIdentifier'], 'Wrong bundle ID'
assert info['CFBundleShortVersionString'] == expo['version'], 'Wrong public version'
assert info['CFBundleVersion'] == expo['ios']['buildNumber'], 'Wrong build number'
assert entitlements.get('get-task-allow') is False, 'Development signing is not allowed'
assert entitlements.get('aps-environment') == 'production', 'Production APNs entitlement missing'
assert not profile.get('ProvisionedDevices'), 'Ad hoc provisioning is not allowed'
assert not profile.get('ProvisionsAllDevices'), 'Enterprise provisioning is not allowed'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Provisioning profile expired'
assert entitlements['application-identifier'] == profile['Entitlements']['application-identifier'], 'Signing identity mismatch'
subprocess.run(['lipo', '-verify_arch', 'arm64', str(app / info['CFBundleExecutable'])], check=True)
print(f"Verified App Store IPA: {info['CFBundleIdentifier']} {info['CFBundleShortVersionString']} ({info['CFBundleVersion']})")
PY
