import {
  useGlobalSearchParams,
  usePathname,
  useSegments,
  type Href,
} from "expo-router";
import { useEffect, useState } from "react";

/** Which half of the drawer the open screen belongs to, as on the web. */
export type SidebarMode = "chat" | "agents";

/** Screens that belong to neither mode keep the drawer in its current one. */
const NEUTRAL_PATHS = ["/settings", "/personalization", "/sign-in-request"];

/** Params that act once as a screen opens, so returning does not repeat them. */
const ONE_SHOT_PARAMS = ["focus"];

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

/** A screen to return to: a path, or a route with the params it was opened with. */
export type SidebarModeHref = Href;

/** Where each mode starts when it has not been visited since launch. */
export const SIDEBAR_MODE_HOME: Record<SidebarMode, Href> = {
  chat: "/chat",
  agents: "/agents",
};

type SidebarModeMemory = {
  /** Whose screens these are: one account on one server. */
  owner: string | null;
  mode: SidebarMode;
  href: Partial<Record<SidebarMode, SidebarModeHref>>;
};

// Per app run, so switching back to a mode returns to where it was left.
let memory: SidebarModeMemory = { owner: null, mode: "chat", href: {} };

export function rememberSidebarMode(mode: SidebarMode, href: SidebarModeHref | null) {
  memory = {
    ...memory,
    mode,
    href: href === null ? memory.href : { ...memory.href, [mode]: href },
  };
}

/** The screen a mode returns to: its last one, or its home. */
export function sidebarModeHref(mode: SidebarMode): SidebarModeHref {
  return memory.href[mode] ?? SIDEBAR_MODE_HOME[mode];
}

/**
 * Keeps the memory for the account that made it. Another account, or the
 * same one on another server, starts afresh rather than being sent to a
 * session that is not theirs.
 */
export function claimSidebarModeMemory(owner: string) {
  if (memory.owner === owner) return;
  memory = { owner, mode: "chat", href: {} };
}

/** Forgets the owner, mode and screens, for tests. */
export function resetSidebarModeMemory() {
  memory = { owner: null, mode: "chat", href: {} };
}

/**
 * The open screen as its route and params, as the app navigates to it, so a
 * folder or session screen comes back with the folder or session it showed.
 */
export function screenHref(
  segments: readonly string[],
  params: Record<string, string | string[]>,
): SidebarModeHref {
  // The segments spell a route the router matched, which typed routes cannot see.
  return {
    pathname: `/${segments.join("/")}`,
    params: Object.fromEntries(
      Object.entries(params).filter(([key]) => !ONE_SHOT_PARAMS.includes(key)),
    ),
  } as Href;
}

/**
 * The mode the open screen belongs to; settings keep the previous one. The
 * owner is the signed-in account on its server, or null while that is unknown.
 */
export function useSidebarMode(owner: string | null): SidebarMode {
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  if (owner) claimSidebarModeMemory(owner);
  const [mode, setMode] = useState(() => memory.mode);
  const derived = sidebarModeForPath(pathname, mode);
  if (derived !== mode) setMode(derived);
  useEffect(() => {
    rememberSidebarMode(
      derived,
      isNeutralSidebarPath(pathname) ? null : screenHref(segments, params),
    );
  }, [derived, pathname, segments, params]);
  return derived;
}
