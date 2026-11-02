"use client";

import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import {
  FolderMinus,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatUpdatedAt } from "@overtchat/shared";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  type ChatListItem,
  useActiveChatIds,
  useChats,
  useDeleteChat,
  useMoveChat,
  useRenameChat,
} from "@/lib/queries/chats";

/** Long lists get a filter; short ones are easier to scan without it. */
const FILTER_THRESHOLD = 6;

const menuItemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

export function ProjectChatList({ projectId }: { projectId: string }) {
  const { data: chats, isPending } = useChats();
  const { data: activeChatIds } = useActiveChatIds();
  const deleteMut = useDeleteChat();
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<ChatListItem | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const projectChats = useMemo(
    () =>
      (chats ?? [])
        .filter((chat) => chat.projectId === projectId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, projectId],
  );
  const query = filter.trim().toLowerCase();
  const visibleChats = query
    ? projectChats.filter((chat) =>
        (chat.title ?? "Untitled").toLowerCase().includes(query),
      )
    : projectChats;
  // Keeps labels such as "5m ago" current while the page stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError("");
    try {
      await deleteMut.mutateAsync(deleting.id);
      setDeleting(null);
      toast.success("Chat deleted");
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Failed to delete"));
    }
  }

  return (
    <section aria-labelledby="project-chats-heading">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2
          id="project-chats-heading"
          className="text-sm font-medium text-muted-foreground"
        >
          Chats
          {projectChats.length > 0 && (
            <span className="ml-1.5 tabular-nums text-muted-foreground/70">
              {projectChats.length}
            </span>
          )}
        </h2>
        {projectChats.length > FILTER_THRESHOLD && (
          <label className="relative w-48 max-sm:w-40">
            <span className="sr-only">Filter chats</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter chats"
              className="h-8 w-full rounded-lg border border-input bg-transparent pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </label>
        )}
      </div>

      {isPending ? (
        <div className="mt-3 space-y-2">
          <div className="h-14 rounded-lg motion-skeleton" />
          <div className="h-14 rounded-lg motion-skeleton" />
        </div>
      ) : projectChats.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center">
          <MessageSquare className="size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No chats yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Start a conversation above. Chats here share this project&apos;s
            instructions and default model.
          </p>
        </div>
      ) : visibleChats.length === 0 ? (
        <p className="mt-3 px-3 py-6 text-center text-sm text-muted-foreground">
          No chats match{" "}
          <span className="text-foreground">{filter.trim()}</span>.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60">
          {visibleChats.map((chat) => (
            <ProjectChatRow
              key={chat.id}
              chat={chat}
              now={now}
              generating={activeChatIds?.includes(chat.id) ?? false}
              onDelete={() => {
                setDeleteError("");
                setDeleting(chat);
              }}
            />
          ))}
        </ul>
      )}

      <AlertDialog.Root
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next && !deleteMut.isPending) {
            setDeleting(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-50 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Delete chat?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {deleting?.title?.trim() || "Untitled"}
              </span>{" "}
              will be permanently deleted.
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
    </section>
  );
}

function ProjectChatRow({
  chat,
  now,
  generating,
  onDelete,
}: {
  chat: ChatListItem;
  now: number;
  generating: boolean;
  onDelete: () => void;
}) {
  const renameMut = useRenameChat();
  const moveMut = useMoveChat();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const title = chat.title?.trim() || "Untitled";

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === chat.title) return;
    renameMut.mutate(
      { id: chat.id, title: next },
      {
        onError: (err) => {
          toast.error({
            title: "Failed to rename chat",
            description: getErrorMessage(err, "The chat title was not changed."),
          });
        },
      },
    );
  }

  function removeFromProject() {
    moveMut.mutate(
      { id: chat.id, projectId: null },
      {
        onSuccess: () =>
          toast.success({
            title: "Removed from project",
            description: "The chat moved to your main list.",
          }),
        onError: (err) => {
          toast.error({
            title: "Failed to move chat",
            description: getErrorMessage(err, "The chat stayed where it was."),
          });
        },
      },
    );
  }

  if (renaming) {
    return (
      <li className="py-2">
        <input
          autoFocus
          aria-label="Chat title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setRenaming(false);
            }
          }}
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
      </li>
    );
  }

  return (
    <li
      data-menu-open={menuOpen || undefined}
      className="group relative -mx-3 flex items-center rounded-lg motion-colors hover:bg-accent/60 data-[menu-open=true]:bg-accent/60"
    >
      <Link
        to="/chat/$id"
        params={{ id: chat.id }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 pr-12 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            {chat.pinned && (
              <Pin
                aria-label="Pinned"
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {generating ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className={cn("size-3", motionClasses.spinner)}
                />
                Responding…
              </>
            ) : (
              <time dateTime={new Date(chat.updatedAt).toISOString()}>
                {formatUpdatedAt(chat.updatedAt, now)}
              </time>
            )}
          </span>
        </span>
      </Link>
      <Menu.Root onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-label={`Actions for ${title}`}
          className={cn(
            "absolute right-2 flex size-8 items-center justify-center rounded-md text-muted-foreground motion-opacity hover:bg-background/60 hover:text-foreground",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[menu-open=true]:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup
              className={cn(
                "z-50 w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                motionClasses.popup,
              )}
            >
              <Menu.Item
                onClick={() => {
                  setDraft(chat.title ?? "");
                  setRenaming(true);
                }}
                className={menuItemClass}
              >
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Rename</span>
              </Menu.Item>
              <Menu.Item onClick={removeFromProject} className={menuItemClass}>
                <FolderMinus className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Remove from project</span>
              </Menu.Item>
              <Menu.Item
                onClick={onDelete}
                className={cn(menuItemClass, "text-destructive data-[highlighted]:text-destructive")}
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
