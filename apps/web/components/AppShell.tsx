"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { SidebarContext } from "@/components/sidebar-context";
import { SearchChatsPalette } from "@/components/SearchChatsPalette";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  SIDEBAR_COLLAPSED_ATTRIBUTE,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "@/lib/sidebar";
import { useIsMobile } from "@/lib/useIsMobile";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [openMobileRoute, setOpenMobileRoute] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setStoredCollapsed] = useLocalStorage<boolean>(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    false,
  );
  const drawerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const openMobile = isMobile && openMobileRoute === routeKey;

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closeMobile = useCallback(() => setOpenMobileRoute(null), []);
  const setOpenMobile = useCallback(
    (next: boolean) => setOpenMobileRoute(next ? routeKey : null),
    [routeKey],
  );
  const setCollapsed = useCallback(
    (next: boolean) => {
      document.documentElement.toggleAttribute(
        SIDEBAR_COLLAPSED_ATTRIBUTE,
        next,
      );
      setStoredCollapsed(next);
    },
    [setStoredCollapsed],
  );
  const openSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(true);
    } else {
      setCollapsed(false);
    }
  }, [isMobile, setCollapsed, setOpenMobile]);
  const closeSidebar = useCallback(() => {
    if (isMobile) {
      closeMobile();
    } else {
      setCollapsed(true);
    }
  }, [closeMobile, isMobile, setCollapsed]);

  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(
      SIDEBAR_COLLAPSED_ATTRIBUTE,
      collapsed,
    );
  }, [collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === "o" && e.shiftKey) {
        e.preventDefault();
        closeMobile();
        router.push("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMobile, router]);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        openSidebar,
        closeSidebar,
        closeMobile,
        openPalette,
        drawerRef,
      }}
    >
      <Dialog.Root
        open={openMobile}
        onOpenChange={setOpenMobile}
        onOpenChangeComplete={(open) => {
          if (!open) setOpenMobileRoute(null);
        }}
      >
        <div className="box-border flex h-dvh overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
          <div
            data-desktop-sidebar
            aria-hidden={collapsed}
            inert={collapsed}
            className={cn(
              "relative hidden h-full shrink-0 motion-width md:block",
              collapsed ? "w-0" : "w-64",
            )}
          >
            <div
              data-desktop-sidebar-panel
              className={cn(
                "absolute inset-y-0 left-0 flex w-64 motion-transform",
                collapsed && "-translate-x-full",
              )}
            >
              {sidebar}
            </div>
          </div>
          <Dialog.Portal>
            <Dialog.Backdrop
              className={`fixed inset-0 z-40 bg-black/40 md:hidden ${motionClasses.overlay}`}
            />
            <Dialog.Popup
              ref={drawerRef as React.RefObject<HTMLDivElement>}
              className="fixed inset-y-0 left-0 z-50 box-border flex bg-sidebar pt-[env(safe-area-inset-top)] motion-transform data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full md:hidden"
            >
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              {sidebar}
            </Dialog.Popup>
          </Dialog.Portal>
          <main className="flex flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
      </Dialog.Root>
      <SearchChatsPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarContext.Provider>
  );
}
