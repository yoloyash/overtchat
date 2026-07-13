"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
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
import { Button } from "@/components/ui/button";

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
          No chats yet
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [revealNextTitle, setRevealNextTitle] = useState(chat.title === null);
  const markTitleRevealComplete = useCallback(() => {
    setRevealNextTitle(false);
  }, []);

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === (chat.title ?? "")) return;
    renameMut.mutate({ id: chat.id, title: next });
  }

  function requestDelete() {
    setDeleteError("");
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    setDeleteError("");
    try {
      await deleteMut.mutateAsync(chat.id);
      setDeleteOpen(false);
      if (active) router.push("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete");
    }
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
    <>
      <li className="group flex items-center">
        <Link
          href={`/chat/${chat.id}`}
          className={cn(
            "flex-1 truncate rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
            active && "bg-sidebar-accent",
          )}
        >
          {chat.title ? (
            <RevealedTitle
              key={chat.title}
              title={chat.title}
              reveal={revealNextTitle}
              onComplete={markTitleRevealComplete}
            />
          ) : (
            "Untitled"
          )}
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
                  onClick={requestDelete}
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

      <AlertDialog.Root
        open={deleteOpen}
        onOpenChange={(next) => {
          if (next) {
            setDeleteOpen(true);
          } else if (!deleteMut.isPending) {
            setDeleteOpen(false);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Delete chat?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {chat.title?.trim() ? (
                <>
                  <span className="font-medium text-foreground">
                    {chat.title.trim()}
                  </span>{" "}
                  will be permanently deleted.
                </>
              ) : (
                "This chat will be permanently deleted."
              )}
            </AlertDialog.Description>
            {deleteError && (
              <p className="mt-3 text-xs text-destructive">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMut.isPending}
                  />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={confirmDelete}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function RevealedTitle({
  title,
  reveal,
  onComplete,
}: {
  title: string;
  reveal: boolean;
  onComplete: () => void;
}) {
  const chars = Array.from(title);
  const [length, setLength] = useState(() =>
    reveal ? Math.min(1, chars.length) : chars.length,
  );

  useEffect(() => {
    if (!reveal) return;

    let nextLength = Math.min(1, chars.length);

    const interval = window.setInterval(() => {
      nextLength = Math.min(chars.length, nextLength + 2);
      setLength(nextLength);
      if (nextLength >= chars.length) {
        window.clearInterval(interval);
        onComplete();
      }
    }, 24);

    return () => window.clearInterval(interval);
  }, [chars.length, onComplete, reveal]);

  return <>{reveal ? chars.slice(0, length).join("") : title}</>;
}
