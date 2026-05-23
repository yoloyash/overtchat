"use client";

import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/sidebar-context";

export function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, setCollapsed, setOpenMobile } = useSidebar();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Open sidebar"
      className={cn(!collapsed && "md:hidden", className)}
      onClick={() => {
        if (collapsed) setCollapsed(false);
        setOpenMobile(true);
      }}
    >
      <PanelLeft />
    </Button>
  );
}
