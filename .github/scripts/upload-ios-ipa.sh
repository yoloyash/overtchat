#!/usr/bin/env bash
# Upload the verified archive directly from the macOS build runner to Apple.
set -euo pipefail

IPA="${1:?Usage: upload-ios-ipa.sh path/to/app.ipa}"
test -f "$IPA"
: "${ASC_API_KEY_ID:?Missing App Store Connect key ID}"
: "${ASC_API_ISSUER_ID:?Missing App Store Connect issuer ID}"
: "${ASC_API_PRIVATE_KEY:?Missing App Store Connect private key}"
[[ "$ASC_API_KEY_ID" =~ ^[A-Za-z0-9]+$ ]]

umask 077
API_PRIVATE_KEYS_DIR="$(mktemp -d)"
export API_PRIVATE_KEYS_DIR
trap 'rm -rf "$API_PRIVATE_KEYS_DIR"' EXIT
printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$API_PRIVATE_KEYS_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
unset ASC_API_PRIVATE_KEY

# Successful delivery is followed by asynchronous processing on Apple's side.
# Do not automatically retry: Apple may have received a timed-out upload.
xcrun altool --upload-app --type ios --file "$IPA" \
  --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_ISSUER_ID" \
  --output-format json

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat >> "$GITHUB_STEP_SUMMARY" <<'SUMMARY'
### iOS archive delivered to Apple

The verified IPA was uploaded directly from the GitHub macOS runner.
Check [App Store Connect](https://appstoreconnect.apple.com/apps/6812165221/testflight/ios)
for processing status and TestFlight availability. App Review remains a manual step.
SUMMARY
fi
