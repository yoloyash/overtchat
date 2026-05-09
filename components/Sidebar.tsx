import Link from "next/link";
import { headers } from "next/headers";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { listChats } from "@/lib/db/chats";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/AccountMenu";
import { SidebarChatList } from "@/components/SidebarChatList";

export async function Sidebar() {
  const session = await auth.api.getSession({ headers: await headers() });
  const chats = session ? await listChats(session.user.id) : [];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="text-sm font-semibold tracking-tight">overtchat</span>
        <Button
          render={<Link href="/" />}
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Plus />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        <SidebarChatList
          chats={chats.map((c) => ({ id: c.id, title: c.title }))}
        />
      </div>

      <div className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </div>
    </aside>
  );
}
