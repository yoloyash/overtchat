import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SettingsNav } from "./SettingsNav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <SidebarToggle />
        <span className="text-sm font-semibold tracking-tight">Settings</span>
        <div className="flex-1" />
        <Button
          render={<Link href="/" />}
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
        >
          <X />
        </Button>
      </header>
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="shrink-0 overflow-y-auto border-b p-3 md:w-56 md:border-r md:border-b-0">
          <SettingsNav />
        </aside>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </div>
    </div>
  );
}
