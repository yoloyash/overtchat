import type { DesktopBridge } from "@overtchat/shared/desktop";

declare global {
  interface Window {
    /** Present when the UI runs inside the OvertChat desktop app. */
    overtchatDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.overtchatDesktop;
}
