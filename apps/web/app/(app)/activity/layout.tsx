import { Activity } from "lucide-react";
import { SidebarToggle } from "@/components/SidebarToggle";

export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarToggle />
        <Activity className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Activity</span>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
