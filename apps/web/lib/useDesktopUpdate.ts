"use client";

import { useEffect, useState } from "react";
import { i18n } from "@overtchat/shared/i18n";
import type { DesktopUpdateState } from "@overtchat/shared/desktop";
import { desktopBridge } from "@/lib/desktop";

export function useDesktopUpdate(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = bridge.onUpdateState((next) => {
      receivedEvent = true;
      if (active) setState(next);
    });
    void bridge.getUpdateState().then((next) => {
      if (active && !receivedEvent) setState(next);
    }).catch(() => {
      // The app can be closing; a later state event will refresh the UI.
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  return state;
}

export function desktopUpdateLabel(state: DesktopUpdateState | null): string {
  switch (state?.status) {
    case "checking": return i18n.t("app.desktopUpdate.checking");
    case "available": return i18n.t("app.desktopUpdate.available");
    case "downloading": return i18n.t("app.desktopUpdate.downloading", { percent: state.downloadPercent ?? 0 });
    case "ready": return i18n.t("app.desktopUpdate.ready");
    case "installing": return i18n.t("app.desktopUpdate.installing");
    case "error": return i18n.t("app.desktopUpdate.error");
    case "blocked": return i18n.t("app.desktopUpdate.blocked");
    case "unsupported": return i18n.t("app.desktopUpdate.unsupported");
    default: return i18n.t("app.desktopUpdate.check");
  }
}
