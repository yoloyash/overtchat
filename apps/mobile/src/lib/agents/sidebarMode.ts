import { usePathname } from "expo-router";
import { useEffect, useState } from "react";

/** Which half of the drawer the open screen belongs to, as on the web. */
export type SidebarMode = "chat" | "agents";

/** Screens that belong to neither mode keep the drawer in its current one. */
const NEUTRAL_PATHS = ["/settings", "/personalization", "/sign-in-request"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isNeutralSidebarPath(pathname: string): boolean {
  return NEUTRAL_PATHS.some((prefix) => matches(pathname, prefix));
}

export function sidebarModeForPath(
  pathname: string,
  current: SidebarMode,
): SidebarMode {
  // Agent conversations sit beside the chat screen; the Agents stack below.
  if (matches(pathname, "/agents") || matches(pathname, "/agent")) return "agents";
  if (isNeutralSidebarPath(pathname)) return current;
  return "chat";
}

/** Where each mode starts when it has not been visited since launch. */
export const SIDEBAR_MODE_HOME: Record<SidebarMode, string> = {
  chat: "/chat",
  agents: "/agents",
};

type SidebarModeMemory = {
  mode: SidebarMode;
  href: Partial<Record<SidebarMode, string>>;
};

// Per app run, so switching back to a mode returns to where it was left.
let memory: SidebarModeMemory = { mode: "chat", href: {} };

export function rememberSidebarMode(mode: SidebarMode, href: string | null) {
  memory = {
    mode,
    href: href === null ? memory.href : { ...memory.href, [mode]: href },
  };
}

/** The screen a mode returns to: its last one, or its home. */
export function sidebarModeHref(mode: SidebarMode): string {
  return memory.href[mode] ?? SIDEBAR_MODE_HOME[mode];
}

/** Forgets the remembered mode and screens, for tests and sign-out. */
export function resetSidebarModeMemory() {
  memory = { mode: "chat", href: {} };
}

/** The mode the open screen belongs to; settings keep the previous one. */
export function useSidebarMode(): SidebarMode {
  const pathname = usePathname();
  const [mode, setMode] = useState(() => memory.mode);
  const derived = sidebarModeForPath(pathname, mode);
  if (derived !== mode) setMode(derived);
  useEffect(() => {
    rememberSidebarMode(derived, isNeutralSidebarPath(pathname) ? null : pathname);
  }, [derived, pathname]);
  return derived;
}
