"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteChatAction,
  renameChatAction,
} from "@/app/(app)/actions";

interface Chat {
  id: string;
  title: string | null;
}

export function SidebarChatList({ chats }: { chats: Chat[] }) {
  if (chats.length === 0) {
    return (
      <p className="py-1.5 text-xs text-muted-foreground">
        No conversations yet
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 py-1">
      {chats.map((c) => (
        <SidebarItem key={c.id} chat={c} />
      ))}
    </ul>
  );
}

function SidebarItem({ chat }: { chat: Chat }) {
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname === `/chat/${chat.id}`;

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");
  const [, startTransition] = useTransition();

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === (chat.title ?? "")) return;
    startTransition(async () => {
      await renameChatAction(chat.id, next);
    });
  }

  function confirmDelete() {
    if (!window.confirm("Delete this chat?")) return;
    startTransition(async () => {
      await deleteChatAction(chat.id);
      if (active) router.push("/");
    });
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
          className="mr-0.5 rounded p-1 opacity-0 transition-opacity hover:bg-sidebar-accent group-hover:opacity-100 data-[popup-open]:opacity-100"
        >
          <MoreHorizontal className="size-3.5 text-muted-foreground" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={6}>
            <Menu.Popup className="z-50 w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
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
