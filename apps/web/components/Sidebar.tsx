import { AccountMenu } from "@/components/AccountMenu";
import { SidebarClient } from "@/components/SidebarClient";

export function Sidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <SidebarClient />
      <div className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </div>
    </aside>
  );
}
