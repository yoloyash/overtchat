export type SidebarMode = "chat" | "agents";

/** Pages that belong to neither mode keep the sidebar in its current one. */
const NEUTRAL_PATHS = ["/settings"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether a page belongs to neither mode. */
export function isNeutralSidebarPath(pathname: string): boolean {
  return NEUTRAL_PATHS.some((prefix) => matches(pathname, prefix));
}

export function sidebarModeForPath(
  pathname: string,
  current: SidebarMode,
): SidebarMode {
  if (matches(pathname, "/agents")) return "agents";
  if (isNeutralSidebarPath(pathname)) return current;
  return "chat";
}

/** Where each mode starts when it has not been visited in this tab. */
export const SIDEBAR_MODE_HOME: Record<SidebarMode, string> = {
  chat: "/",
  agents: "/agents",
};
