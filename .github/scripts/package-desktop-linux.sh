#!/usr/bin/env bash
set -euo pipefail

test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
npm run package:linux -w apps/desktop --

release="$PWD/apps/desktop/release"
version=$(node -p 'require("./apps/desktop/package.json").version')
prefix="overtchat-$version-linux-x64"
verification_directory=$(mktemp -d)
trap 'rm -rf "$verification_directory"' EXIT
verify() { node .github/scripts/verify-desktop-linux.mjs "$1"; }
verify "$release/linux-unpacked"

mkdir "$verification_directory/appimage"
(cd "$verification_directory/appimage" && "$release/overtchat-linux-x64.AppImage" --appimage-extract >/dev/null)
verify "$verification_directory/appimage/squashfs-root"
test ! -e "$verification_directory/appimage/squashfs-root/resources/package-type"
if grep -- '--no-sandbox' "$verification_directory/appimage/squashfs-root/"*.desktop; then
  echo 'AppImage launcher disables the sandbox.' >&2
  exit 1
fi

mkdir "$verification_directory/tar"
tar -xzf "$release/$prefix.tar.gz" -C "$verification_directory/tar"
tar_app=$(find "$verification_directory/tar" -maxdepth 2 -type f -name overtchat-desktop -printf '%h\n')
test -n "$tar_app"
verify "$tar_app"
test ! -e "$tar_app/resources/package-type"

test "$(dpkg-deb --field "$release/$prefix.deb" Package)" = overtchat-desktop
test "$(dpkg-deb --field "$release/$prefix.deb" Version)" = "$version"
test "$(dpkg-deb --field "$release/$prefix.deb" Architecture)" = amd64
dpkg-deb --extract "$release/$prefix.deb" "$verification_directory/deb"
dpkg-deb --control "$release/$prefix.deb" "$verification_directory/deb-control"
verify "$verification_directory/deb/opt/overtchat"
test "$(cat "$verification_directory/deb/opt/overtchat/resources/package-type")" = deb
grep -q 'chmod 4755' "$verification_directory/deb-control/postinst"
desktop-file-validate "$verification_directory/deb/usr/share/applications/com.overtchat.desktop.desktop"

test "$(rpm --query --package --queryformat '%{NAME}:%{VERSION}:%{ARCH}' "$release/$prefix.rpm")" = "overtchat-desktop:$version:x86_64"
mkdir "$verification_directory/rpm"
(cd "$verification_directory/rpm" && rpm2cpio "$release/$prefix.rpm" | cpio --extract --make-directories --quiet)
verify "$verification_directory/rpm/opt/overtchat"
test "$(cat "$verification_directory/rpm/opt/overtchat/resources/package-type")" = rpm
desktop-file-validate "$verification_directory/rpm/usr/share/applications/com.overtchat.desktop.desktop"

update_metadata=$(node --import tsx .github/scripts/desktop-update-metadata.mjs linux x64)
(cd "$release" && sha256sum overtchat-linux-x64.AppImage "$prefix.deb" "$prefix.rpm" "$prefix.tar.gz" "$update_metadata" \
  > desktop-checksums-linux-x64.txt && sha256sum --check desktop-checksums-linux-x64.txt)
