"use client";

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import {
  CalendarClock,
  Download,
  FolderInput,
  MoreHorizontal,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import type { ChatKind } from "@overtchat/shared";
import { cn } from "@/lib/utils";
import { groupByDate } from "@/lib/dateGroups";
import {
  useDeleteChat,
  useMoveChat,
  useRenameChat,
  useSetChatPinned,
} from "@/lib/queries/chats";
import { getErrorMessage } from "@/lib/errors";
import { useSidebar } from "@/components/sidebar-context";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { apiUrl } from "@/lib/api-url";
import { usePublicCapabilities } from "@/lib/queries/capabilities";

interface Chat {
  id: string;
  title: string | null;
  kind: ChatKind;
  pinned?: boolean;
  /** The scheduled task whose run started the chat. */
  scheduledTaskName?: string;
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
  activeChatIds,
  unreadChatIds,
  emptyMessage,
  pinningSupported,
}: {
  chats: DatedChat[];
  projects: ProjectOption[];
  activeChatIds: ReadonlySet<string>;
  /** Chats a scheduled task wrote that have not been opened. */
  unreadChatIds: ReadonlySet<string>;
  emptyMessage?: string;
  pinningSupported: boolean;
}) {
  const { t } = useTranslation();
  if (chats.length === 0) {
    return (
      <>
        <div className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t("sidebar.sections.recents")}
        </div>
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {emptyMessage ?? t("sidebar.sections.noChatsYet")}
        </p>
      </>
    );
  }
  const groups = groupByDate(chats, t);
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {g.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((c) => (
              <SidebarItem
                key={c.id}
                chat={c}
                projects={projects}
                generating={activeChatIds.has(c.id)}
                unread={unreadChatIds.has(c.id)}
                pinningSupported={pinningSupported}
              />
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
  generating = false,
  unread = false,
  pinningSupported,
}: {
  chat: Chat;
  projects: ProjectOption[];
  currentProjectId?: string | null;
  generating?: boolean;
  /** A scheduled task wrote this chat and it has not been opened. */
  unread?: boolean;
  pinningSupported: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const active = pathname === `/chat/${chat.id}`;
  // See AccountMenu for the full explanation; mobile drawer needs in-subtree portaling.
  const { closeMobile, drawerRef, pinFocusRef } = useSidebar();

  const renameMut = useRenameChat();
  const deleteMut = useDeleteChat();
  const moveMut = useMoveChat();
  const pinMut = useSetChatPinned();
  const rowRef = useRef<HTMLLIElement>(null);
  const pinFromMenuRef = useRef(false);

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [revealNextTitle, setRevealNextTitle] = useState(chat.title === null);
  const markTitleRevealComplete = useCallback(() => {
    setRevealNextTitle(false);
  }, []);

  async function togglePin(fromMenu = false) {
    const row = rowRef.current;
    const sidebar = row?.closest("aside");
    const hadFocus = fromMenu || row?.contains(document.activeElement);
    pinFromMenuRef.current = fromMenu;
    const focusRequest = hadFocus && row && sidebar ? {
      id: chat.id,
      pinned: !chat.pinned,
      row,
      sidebar,
      focusedElement: document.activeElement,
      fromMenu,
    } : null;
    if (focusRequest) pinFocusRef.current = focusRequest;
    try {
      await pinMut.mutateAsync({ id: chat.id, pinned: !chat.pinned });
    } catch (err) {
      pinFromMenuRef.current = false;
      if (pinFocusRef.current === focusRequest) pinFocusRef.current = null;
      if (hadFocus && document.activeElement === document.body) {
        row?.querySelector<HTMLAnchorElement>("a")?.focus();
      }
      toast.error({
        title: chat.pinned ? t("sidebar.chat.unpinErrorTitle") : t("sidebar.chat.pinErrorTitle"),
        description: getErrorMessage(err, t("sidebar.chat.pinErrorFallback")),
      });
    }
  }

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === (chat.title ?? "")) return;
    renameMut.mutate(
      { id: chat.id, title: next },
      {
        onError: (err) => {
          toast.error({
            title: t("sidebar.chat.renameErrorTitle"),
            description: getErrorMessage(err, t("sidebar.chat.renameErrorFallback")),
          });
        },
      },
    );
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
      toast.success(t("sidebar.chat.deletedTitle"));
      if (active) void navigate({ to: "/" });
    } catch (err) {
      setDeleteError(getErrorMessage(err, t("sidebar.chat.deleteErrorFallback")));
    }
  }

  function moveTo(projectId: string | null) {
    if (projectId === currentProjectId) return;
    moveMut.mutate(
      { id: chat.id, projectId },
      {
        onError: (err) => {
          toast.error({
            title: t("sidebar.chat.moveErrorTitle"),
            description: getErrorMessage(err, t("sidebar.chat.moveErrorFallback")),
          });
        },
      },
    );
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
      <li
        ref={rowRef}
        data-chat-id={chat.id}
        data-menu-open={menuOpen || undefined}
        className={cn(
          "group relative flex items-center rounded-md motion-colors hover:bg-sidebar-accent [--chat-title-padding:var(--chat-actions-padding)]",
          pinningSupported
            ? "[--chat-actions-padding:3.5rem] max-md:[--chat-actions-padding:4.5rem]"
            : "[--chat-actions-padding:2rem] max-md:[--chat-actions-padding:2.5rem]",
          generating && "[@media(hover:none)]:[--chat-title-padding:calc(var(--chat-actions-padding)+2rem)]",
          (active || menuOpen) && "bg-sidebar-accent",
        )}
      >
        <Link
          to="/chat/$id"
          params={{ id: chat.id }}
          onClick={closeMobile}
          className={cn(
            "block min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm",
            // Hidden actions overlay the title instead of reserving empty space.
            "group-hover:pr-(--chat-title-padding) group-focus-within:pr-(--chat-title-padding) group-data-[menu-open=true]:pr-(--chat-title-padding) [@media(hover:none)]:pr-(--chat-title-padding)",
            (chat.pinned || generating) && "pr-8 max-md:pr-10",
            chat.pinned && generating && "pr-14 max-md:pr-18",
          )}
        >
          {unread && !generating && (
            <span
              role="img"
              aria-label={t("sidebar.chat.newResult")}
              data-unread-run
              className="mr-1.5 inline-block size-1.5 rounded-full bg-green-600 align-middle dark:bg-green-500"
            />
          )}
          {chat.scheduledTaskName && (
            <CalendarClock
              role="img"
              aria-label={t("sidebar.chat.scheduledTask")}
              data-scheduled-chat
              className="mr-1.5 inline-block size-3.5 align-[-0.15em] text-muted-foreground"
            />
          )}
          {chat.title ? (
            <RevealedTitle
              key={chat.title}
              title={chat.title}
              reveal={revealNextTitle}
              onComplete={markTitleRevealComplete}
            />
          ) : (
            t("common.states.untitled")
          )}
        </Link>
        {generating && (
          <span
            role="status"
            aria-label={t("sidebar.chat.generatingFor", { title: chat.title?.trim() || t("common.states.untitled") })}
            className={cn(
              "pointer-events-none absolute right-1 flex size-5.5 items-center justify-center text-muted-foreground motion-opacity max-md:size-7.5",
              "[@media(hover:hover)]:group-hover:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-0 [@media(hover:hover)]:group-data-[menu-open=true]:opacity-0 [@media(hover:none)]:right-(--chat-actions-padding)",
              chat.pinned && "right-7 max-md:right-9",
            )}
          >
            <LoaderCircle
              aria-hidden="true"
              className={cn("size-3.5", motionClasses.spinner)}
            />
          </span>
        )}
        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5">
          <Menu.Root onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) pinFromMenuRef.current = false;
          }}>
            <Menu.Trigger
              aria-label={t("sidebar.chat.actionsLabel")}
              className={cn(
                "pointer-events-auto flex size-5.5 shrink-0 items-center justify-center rounded text-muted-foreground motion-opacity hover:bg-sidebar-border/60 hover:text-foreground max-md:size-7.5",
                "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[menu-open=true]:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <MoreHorizontal className="size-3.5" />
            </Menu.Trigger>
            <Menu.Portal container={drawerRef}>
              <Menu.Positioner
                anchor={rowRef}
                side="right"
                align="start"
                sideOffset={6}
                collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
              >
                <Menu.Popup
                  // The sidebar restores focus after the list commits. Prevent
                  // delayed menu cleanup from focusing an obsolete trigger.
                  finalFocus={() => !pinFromMenuRef.current}
                  className={cn(
                    "z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                    motionClasses.popup,
                  )}
                >
                  {pinningSupported && (
                    <Menu.Item
                      onClick={() => togglePin(true)}
                      disabled={pinMut.isPending}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      {chat.pinned ? (
                        <PinOff className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Pin className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span>{chat.pinned ? t("sidebar.chat.unpin") : t("sidebar.chat.pin")}</span>
                    </Menu.Item>
                  )}
                  <Menu.Item
                    onClick={() => {
                      setDraft(chat.title ?? "");
                      setRenaming(true);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t("common.actions.rename")}</span>
                  </Menu.Item>
                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent">
                      <FolderInput className="size-3.5 shrink-0 text-muted-foreground" />
                      <span>{t("sidebar.chat.moveTo")}</span>
                      <span className="ml-auto text-muted-foreground">›</span>
                    </Menu.SubmenuTrigger>
                    <Menu.Portal container={drawerRef}>
                      <Menu.Positioner side="right" align="start" sideOffset={6}>
                        <Menu.Popup
                          className={cn(
                            "z-50 max-h-64 w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                            motionClasses.popup,
                          )}
                        >
                          <Menu.Item
                            onClick={() => moveTo(null)}
                            disabled={currentProjectId === null}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                              currentProjectId === null &&
                                "text-muted-foreground",
                            )}
                          >
                            {t("sidebar.chat.noProject")}
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
                                "flex cursor-pointer items-center gap-2 truncate rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
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
                  <ChatExportMenuItem chatId={chat.id} />
                  <Menu.Item
                    onClick={requestDelete}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-destructive outline-none motion-colors data-[highlighted]:bg-accent"
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    <span>{t("common.actions.delete")}</span>
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          {pinningSupported && (
            <button
              type="button"
              aria-label={chat.pinned ? t("sidebar.chat.unpinChat") : t("sidebar.chat.pinChat")}
              title={chat.pinned ? t("sidebar.chat.unpinChat") : t("sidebar.chat.pinChat")}
              disabled={pinMut.isPending}
              onClick={() => togglePin()}
              className={cn(
                "pointer-events-auto flex size-5.5 shrink-0 items-center justify-center rounded text-muted-foreground motion-opacity hover:bg-sidebar-border/60 hover:text-foreground disabled:opacity-50 max-md:size-7.5",
                !chat.pinned && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[menu-open=true]:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <Pin aria-hidden="true" className={cn("size-3.5", chat.pinned && "fill-current")} />
            </button>
          )}
        </div>
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
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-50 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {t("sidebar.chat.deleteDialogTitle")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {chat.title?.trim() ? (
                <Trans
                  i18nKey="sidebar.chat.deleteDialogNamed"
                  values={{ name: chat.title.trim() }}
                  components={{
                    name: <span className="font-medium text-foreground" />,
                  }}
                />
              ) : (
                t("sidebar.chat.deleteDialogUnnamed")
              )}
              <span className="mt-2 block text-xs">
                {t("sidebar.chat.deleteDialogFilesNote")}
              </span>
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
                {t("common.actions.cancel")}
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={confirmDelete}
              >
                {deleteMut.isPending ? t("common.states.deleting") : t("common.actions.delete")}
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
  const reducedMotion = useReducedMotion();
  const [length, setLength] = useState(() =>
    reveal ? Math.min(1, chars.length) : chars.length,
  );

  useEffect(() => {
    if (!reveal) return;
    if (reducedMotion) {
      onComplete();
      return;
    }

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
  }, [chars.length, onComplete, reducedMotion, reveal]);

  return <>{reveal && !reducedMotion ? chars.slice(0, length).join("") : title}</>;
}

const EXPORT_ITEM_CLASSES =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

/**
 * The chat menu's export entry. It offers Markdown beside JSON, or stays the
 * plain JSON download when the server predates Markdown export, as an older
 * server behind the desktop app does.
 */
function ChatExportMenuItem({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const { drawerRef } = useSidebar();
  const { data: capabilities } = usePublicCapabilities();
  const jsonHref = apiUrl(`/api/chat/${chatId}/export`);

  if (capabilities?.capabilities.chatMarkdownExport !== true) {
    return (
      <Menu.Item
        render={<a href={jsonHref} download />}
        className={EXPORT_ITEM_CLASSES}
      >
        <Download className="size-3.5 shrink-0 text-muted-foreground" />
        <span>{t("sidebar.chat.export")}</span>
      </Menu.Item>
    );
  }

  // The server cannot know the reader's time zone, so the link carries it.
  const markdownHref = `${jsonHref}?${new URLSearchParams({
    format: "markdown",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })}`;
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        className={cn(
          EXPORT_ITEM_CLASSES,
          "w-full data-[popup-open]:bg-accent",
        )}
      >
        <Download className="size-3.5 shrink-0 text-muted-foreground" />
        <span>{t("sidebar.chat.export")}</span>
        <span className="ml-auto text-muted-foreground">›</span>
      </Menu.SubmenuTrigger>
      <Menu.Portal container={drawerRef}>
        <Menu.Positioner side="right" align="start" sideOffset={6}>
          <Menu.Popup
            className={cn(
              "z-50 w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Menu.Item
              render={<a href={markdownHref} download />}
              className={EXPORT_ITEM_CLASSES}
            >
              {
                // eslint-disable-next-line i18next/no-literal-string -- format name
                "Markdown"
              }
            </Menu.Item>
            <Menu.Item
              render={<a href={jsonHref} download />}
              className={EXPORT_ITEM_CLASSES}
            >
              JSON
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
