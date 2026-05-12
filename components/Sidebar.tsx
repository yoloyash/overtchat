import Link from "next/link";
import { headers } from "next/headers";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { listChats } from "@/lib/db/chats";
import { listProjects } from "@/lib/db/projects";
import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/components/AccountMenu";
import { SidebarChatList } from "@/components/SidebarChatList";
import { SidebarProjects } from "@/components/SidebarProjects";

export async function Sidebar() {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;

  const [chats, projects] = userId
    ? await Promise.all([listChats(userId), listProjects(userId)])
    : [[], []];

  const projectList = projects.map((p) => ({ id: p.id, name: p.name }));
  const unprojected = chats
    .filter((c) => c.projectId == null)
    .map((c) => ({ id: c.id, title: c.title }));
  const chatsByProject = new Map<string, { id: string; title: string | null }[]>();
  for (const c of chats) {
    if (!c.projectId) continue;
    const list = chatsByProject.get(c.projectId) ?? [];
    list.push({ id: c.id, title: c.title });
    chatsByProject.set(c.projectId, list);
  }
  const projectsWithChats = projectList.map((p) => ({
    ...p,
    chats: chatsByProject.get(p.id) ?? [],
  }));

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
        <SidebarProjects projects={projectsWithChats} />
        <SidebarChatList chats={unprojected} projects={projectList} />
      </div>

      <div className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </div>
    </aside>
  );
}
