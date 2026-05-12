"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FolderPlus, PanelLeft, Pencil, Search } from "lucide-react";
import { SidebarChatList } from "@/components/SidebarChatList";
import {
  SidebarProjects,
  CreateProjectDialog,
} from "@/components/SidebarProjects";
import type { ProjectOption } from "@/components/SidebarChatList";
import { useSidebar } from "@/components/sidebar-context";

type RecentChat = { id: string; title: string | null; updatedAt: number };
type ProjectWithChats = ProjectOption & {
  chats: { id: string; title: string | null }[];
};

export function SidebarClient({
  unprojected,
  projects,
  projectOptions,
}: {
  unprojected: RecentChat[];
  projects: ProjectWithChats[];
  projectOptions: ProjectOption[];
}) {
  const { setOpenMobile, setCollapsed, openPalette } = useSidebar();
  const [creatingProject, setCreatingProject] = useState(false);

  const modKey = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /mac|iphone|ipad|ipod/i.test(navigator.platform)
        ? "⌘"
        : "Ctrl",
    [],
  );

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <span className="text-sm font-semibold tracking-tight">overtchat</span>
        <button
          type="button"
          onClick={() => {
            setOpenMobile(false);
            setCollapsed(true);
          }}
          aria-label="Collapse sidebar"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-md:p-2.5"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <nav className="flex flex-col gap-0.5 py-1">
          <Link
            href="/"
            onClick={() => setOpenMobile(false)}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent"
          >
            <Pencil className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">New chat</span>
            <Shortcut keys={[modKey, "⇧", "O"]} />
          </Link>
          <button
            type="button"
            onClick={openPalette}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent"
          >
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">Search chats</span>
            <Shortcut keys={[modKey, "K"]} />
          </button>
        </nav>

        <SectionLabel>Projects</SectionLabel>
        <SidebarProjects projects={projects} />
        <button
          type="button"
          onClick={() => setCreatingProject(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <FolderPlus className="size-4 shrink-0" />
          <span>New project</span>
        </button>

        <SidebarChatList chats={unprojected} projects={projectOptions} />
      </div>

      <CreateProjectDialog
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
      />
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-sidebar-border bg-sidebar-accent/50 px-1 py-px font-sans leading-none"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
