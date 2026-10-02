#!/usr/bin/env bash
# Credentialed builds run only on trusted manual refs and release tags.
set -euo pipefail
ARCH="${1:?Usage: package-desktop-mac.sh arm64|x64}"
[[ "$ARCH" == arm64 || "$ARCH" == x64 ]]
: "${MACOS_DEVELOPER_ID_P12:?Missing base64 Developer ID Application certificate}"
: "${MACOS_DEVELOPER_ID_PASSWORD:?Missing certificate export password}"
: "${ASC_API_KEY_ID:?Missing App Store Connect team API key ID}"
: "${ASC_API_ISSUER_ID:?Missing App Store Connect issuer ID}"
: "${ASC_API_PRIVATE_KEY:?Missing App Store Connect private key}"
[[ "$ASC_API_KEY_ID" =~ ^[A-Za-z0-9]+$ ]]

umask 077
KEYCHAIN_LIST="$(security list-keychains -d user)"
SIGNING_DIR="$(mktemp -d)"
KEYCHAIN="$SIGNING_DIR/signing.keychain-db"
MOUNT=""
ORIGINAL_KEYCHAINS=()
while IFS= read -r keychain; do
  ORIGINAL_KEYCHAINS+=("$keychain")
done < <(printf '%s\n' "$KEYCHAIN_LIST" | sed -E 's/^ *"//; s/"$//')
cleanup() {
  if [[ -n "$MOUNT" ]]; then hdiutil detach "$MOUNT" >/dev/null || true; fi
  security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" || true
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$SIGNING_DIR"
}
trap cleanup EXIT
printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$SIGNING_DIR/AuthKey.p8"
unset ASC_API_PRIVATE_KEY
export APPLE_API_KEY="$SIGNING_DIR/AuthKey.p8"
export APPLE_API_KEY_ID="$ASC_API_KEY_ID"
export APPLE_API_ISSUER="$ASC_API_ISSUER_ID"
# Use GitHub's standard isolated-keychain setup. electron-builder 26.15.3's
# CSC_LINK importer uses the P12 password for the key partition list even though
# it creates the keychain with a different random password. CSC_KEYCHAIN avoids
# that upstream failure while Electron Builder still owns all bundle signing.
printf '%s' "$MACOS_DEVELOPER_ID_P12" | base64 --decode > "$SIGNING_DIR/DeveloperID.p12"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security import "$SIGNING_DIR/DeveloperID.p12" -k "$KEYCHAIN" \
  -P "$MACOS_DEVELOPER_ID_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security list-keychains -d user -s "$KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
export CSC_KEYCHAIN="$KEYCHAIN"
export CSC_NAME="(C35DR2MHM7)"
unset CSC_LINK CSC_KEY_PASSWORD KEYCHAIN_PASSWORD MACOS_DEVELOPER_ID_P12 MACOS_DEVELOPER_ID_PASSWORD

npm run package:mac:release -w apps/desktop -- "--$ARCH"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
APP=apps/desktop/release/mac/overtchat.app
[[ "$ARCH" != arm64 ]] || APP=apps/desktop/release/mac-arm64/overtchat.app
node .github/scripts/verify-desktop-mac.mjs "$APP" "$ARCH" notarized

# electron-builder notarizes and staples the app before making its archives.
# Apple also recommends submitting the outermost container: notarize the DMG
# separately, then staple it so Gatekeeper can validate an offline install.
DMG="apps/desktop/release/overtchat-$VERSION-mac-$ARCH.dmg"
xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
  --wait --timeout 30m --output-format json > "$SIGNING_DIR/dmg-notarization.json"
python3 - "$SIGNING_DIR/dmg-notarization.json" <<'PY'
import json, sys
with open(sys.argv[1]) as file:
    result = json.load(file)
assert result['status'] == 'Accepted', f"DMG notarization failed: {result['status']} ({result['id']})"
print(f"DMG notarization accepted: {result['id']}")
PY
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
codesign --verify --strict "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

# Check the actual app recovered from each downloadable artifact.
ditto -x -k "apps/desktop/release/overtchat-$VERSION-mac-$ARCH.zip" "$SIGNING_DIR/zip"
node .github/scripts/verify-desktop-mac.mjs "$SIGNING_DIR/zip/overtchat.app" "$ARCH" notarized
MOUNT="$SIGNING_DIR/mount"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT"
node .github/scripts/verify-desktop-mac.mjs "$MOUNT/overtchat.app" "$ARCH" notarized
hdiutil detach "$MOUNT"
MOUNT=""
UPDATE_METADATA="$(node --import tsx .github/scripts/desktop-update-metadata.mjs mac "$ARCH")"
(
  cd apps/desktop/release
  shasum -a 256 "overtchat-$VERSION-mac-$ARCH.dmg" "overtchat-$VERSION-mac-$ARCH.zip" "$UPDATE_METADATA" > "desktop-checksums-$ARCH.txt"
)
