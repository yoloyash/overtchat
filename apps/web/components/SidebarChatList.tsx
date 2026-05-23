"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Download,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { groupByDate } from "@/lib/dateGroups";
import {
  useDeleteChat,
  useMoveChat,
  useRenameChat,
} from "@/lib/queries/chats";
import { useSidebar } from "@/components/sidebar-context";

interface Chat {
  id: string;
  title: string | null;
}

interface DatedChat extends Chat {
  updatedAt: number;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export function SidebarChatList({
  chats,
  projects,
}: {
  chats: DatedChat[];
  projects: ProjectOption[];
}) {
  if (chats.length === 0) {
    return (
      <>
        <div className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Recents
        </div>
        <p className="px-2 py-1 text-xs text-muted-foreground">
          No conversations yet
        </p>
      </>
    );
  }
  const groups = groupByDate(chats);
  return (
    <div>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {g.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((c) => (
              <SidebarItem key={c.id} chat={c} projects={projects} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SidebarItem({
  chat,
  projects,
  currentProjectId = null,
}: {
  chat: Chat;
  projects: ProjectOption[];
  currentProjectId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname === `/chat/${chat.id}`;
  // See AccountMenu for the full explanation; mobile drawer needs in-subtree portaling.
  const { drawerRef } = useSidebar();

  const renameMut = useRenameChat();
  const deleteMut = useDeleteChat();
  const moveMut = useMoveChat();

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === (chat.title ?? "")) return;
    renameMut.mutate({ id: chat.id, title: next });
  }

  function confirmDelete() {
    if (!window.confirm("Delete this chat?")) return;
    deleteMut.mutate(chat.id, {
      onSuccess: () => {
        if (active) router.push("/");
      },
    });
  }

  function moveTo(projectId: string | null) {
    if (projectId === currentProjectId) return;
    moveMut.mutate({ id: chat.id, projectId });
  }

  if (renaming) {
    return (
      <li className="px-1 py-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
      </li>
    );
  }

  return (
    <li className="group flex items-center">
      <Link
        href={`/chat/${chat.id}`}
        className={cn(
          "flex-1 truncate rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        {chat.title ?? "Untitled"}
      </Link>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Chat actions"
          className="mr-0.5 rounded p-1 opacity-0 transition-opacity hover:bg-sidebar-accent group-hover:opacity-100 data-[popup-open]:opacity-100 max-md:p-2 [@media(hover:none)]:opacity-100"
        >
          <MoreHorizontal className="size-3.5 text-muted-foreground" />
        </Menu.Trigger>
        <Menu.Portal container={drawerRef}>
          <Menu.Positioner side="right" align="start" sideOffset={6}>
            <Menu.Popup className="z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
              <Menu.Item
                onClick={() => {
                  setDraft(chat.title ?? "");
                  setRenaming(true);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Rename</span>
              </Menu.Item>
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent">
                  <FolderInput className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>Move to</span>
                  <span className="ml-auto text-muted-foreground">›</span>
                </Menu.SubmenuTrigger>
                <Menu.Portal container={drawerRef}>
                  <Menu.Positioner side="right" align="start" sideOffset={6}>
                    <Menu.Popup className="z-50 max-h-64 w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
                      <Menu.Item
                        onClick={() => moveTo(null)}
                        disabled={currentProjectId === null}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                          currentProjectId === null &&
                            "text-muted-foreground",
                        )}
                      >
                        No project
                      </Menu.Item>
                      {projects.length > 0 && (
                        <div className="my-1 h-px bg-border" />
                      )}
                      {projects.map((p) => (
                        <Menu.Item
                          key={p.id}
                          onClick={() => moveTo(p.id)}
                          disabled={p.id === currentProjectId}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 truncate rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                            p.id === currentProjectId &&
                              "text-muted-foreground",
                          )}
                        >
                          <span className="truncate">{p.name}</span>
                        </Menu.Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
              <Menu.Item
                render={<a href={`/api/chat/${chat.id}/export`} download />}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Export</span>
              </Menu.Item>
              <Menu.Item
                onClick={confirmDelete}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-accent"
              >
                <Trash2 className="size-3.5 shrink-0" />
                <span>Delete</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </li>
  );
}
