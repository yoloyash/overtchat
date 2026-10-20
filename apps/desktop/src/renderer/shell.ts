import { desktopBridge } from "@/lib/desktop";
import type { DesktopShellBridge } from "../shared/ipc";

/** The preload's bridge. The desktop renderer never runs without it. */
export const shell = desktopBridge() as DesktopShellBridge;

export function hostOf(origin: string): string {
  return new URL(origin).host;
}
