#!/bin/bash
set -eu

# RPM runs the old package's removal script after the new install script.
# Builder's removal script deletes the executable link and AppArmor profile
# even during upgrades. Restore integration after the transaction completes,
# including upgrades from already published packages with that removal script.
if command -v update-alternatives >/dev/null 2>&1; then
    update-alternatives --install /usr/bin/overtchat-desktop overtchat-desktop /opt/overtchat/overtchat-desktop 100
else
    ln -sf /opt/overtchat/overtchat-desktop /usr/bin/overtchat-desktop
fi

if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    profile=/opt/overtchat/resources/apparmor-profile
    if apparmor_parser --skip-kernel-load --debug "$profile" >/dev/null 2>&1; then
        install -m 0644 "$profile" /etc/apparmor.d/overtchat-desktop
        if ! { command -v ischroot >/dev/null 2>&1 && ischroot; }; then
            apparmor_parser --replace --write-cache --skip-read-cache "$profile"
        fi
    fi
fi
