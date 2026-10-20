"use client";

import { useEffect, useState } from "react";
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
    case "checking": return "Checking…";
    case "available": return "Desktop app update available";
    case "downloading": return `Downloading ${state.downloadPercent ?? 0}%`;
    case "ready": return "Desktop update ready";
    case "installing": return "Restarting…";
    case "error": return "Retry desktop update";
    case "blocked": return "Update requires attention";
    case "unsupported": return "View update options";
    default: return "Check for updates";
  }
}
