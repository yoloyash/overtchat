"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { SidebarContext } from "@/components/sidebar-context";
import { SearchChatsPalette } from "@/components/SearchChatsPalette";
import { useLocalStorage } from "@/lib/useLocalStorage";

type Chat = { id: string; title: string | null; updatedAt: number };

export function AppShell({
  sidebar,
  allChats,
  children,
}: {
  sidebar: React.ReactNode;
  allChats: Chat[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [openMobile, setOpenMobile] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    "overtchat_sidebar_collapsed",
    false,
  );
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
      }}
    >
      {/* modal={false}: the drawer is navigation, not a confirmation modal.
          Dropping the focus trap lets portaled popups (AccountMenu, chat-row
          menus) inside the sidebar open normally on mobile. */}
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile} modal={false}>
        <div className="flex h-dvh overflow-hidden bg-background">
          {!collapsed && <div className="hidden md:flex">{sidebar}</div>}
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 md:hidden" />
            <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full md:hidden">
              {sidebar}
            </Dialog.Popup>
          </Dialog.Portal>
          <main className="flex flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
      </Dialog.Root>
      <SearchChatsPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        chats={allChats}
      />
    </SidebarContext.Provider>
  );
}
