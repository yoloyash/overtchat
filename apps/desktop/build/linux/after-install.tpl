#!/bin/bash
# shellcheck disable=SC2016
# Single-quoted placeholders are expanded by electron-builder, not the shell.
set -eu

# Keep electron-builder's executable links and desktop integration. Installation
# runs as root; root's user-namespace access does not describe the desktop user.
# Provide Chromium's root-owned SUID helper even when root can use namespaces.
if command -v update-alternatives >/dev/null 2>&1; then
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox'
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox'

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi

# Builder supplies a userns AppArmor profile and removes/unloads it on uninstall.
# Older AppArmor versions do not understand abi/4.0; retain that compatibility.
if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    profile='/opt/${sanitizedProductName}/resources/apparmor-profile'
    if apparmor_parser --skip-kernel-load --debug "$profile" >/dev/null 2>&1; then
        install -m 0644 "$profile" '/etc/apparmor.d/${executable}'
        if ! { command -v ischroot >/dev/null 2>&1 && ischroot; }; then
            apparmor_parser --replace --write-cache --skip-read-cache "$profile"
        fi
    else
        echo 'Skipping AppArmor profile: this AppArmor version does not support it.'
    fi
fi
