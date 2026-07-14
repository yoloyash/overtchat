"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { SidebarContext } from "@/components/sidebar-context";
import { SearchChatsPalette } from "@/components/SearchChatsPalette";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { motionClasses } from "@/lib/motion";
import { useMotionRouter } from "@/lib/useMotionRouter";

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useMotionRouter();
  const [openMobile, setOpenMobile] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    "overtchat_sidebar_collapsed",
    false,
  );
  const drawerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenMobile(false);
  }

  const openPalette = useCallback(() => setPaletteOpen(true), []);

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
        setOpenMobile(false);
        router.push("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed,
        openMobile,
        setOpenMobile,
        openPalette,
        drawerRef,
      }}
    >
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <div className="box-border flex h-dvh overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
          {!collapsed && <div className="hidden md:flex">{sidebar}</div>}
          <Dialog.Portal>
            <Dialog.Backdrop
              className={`fixed inset-0 z-40 bg-black/40 md:hidden ${motionClasses.overlay}`}
            />
            <Dialog.Popup
              ref={drawerRef as React.RefObject<HTMLDivElement>}
              className="fixed inset-y-0 left-0 z-50 box-border flex bg-sidebar pt-[env(safe-area-inset-top)] motion-transform data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full md:hidden"
            >
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
