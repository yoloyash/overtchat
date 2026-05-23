"use client";

import { createContext, useContext, type RefObject } from "react";

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (v: boolean) => void;
  openPalette: () => void;
  // Ref to the mobile drawer's Dialog.Popup element. Popups inside the sidebar
  // pass this to `Menu.Portal container` on mobile so their floating element
  // lives inside the drawer's DOM subtree. Without this, the menu portals to
  // <body>, outside the Dialog's floating tree — the Dialog's dismiss logic
  // doesn't recognize taps on menu items as "inside" events and the menu
  // never opens on touch. Null on desktop (portal to body as usual).
  drawerRef: RefObject<HTMLElement | null>;
}

export const SidebarContext = createContext<SidebarCtx | null>(null);

export function useSidebar(): SidebarCtx {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarContext");
  return ctx;
}
