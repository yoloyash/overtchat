"use client";

import { useTranslation } from "react-i18next";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/sidebar-context";

export function SidebarToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { collapsed, openSidebar } = useSidebar();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("sidebar.toggle.open")}
      data-titlebar-leading
      className={cn(!collapsed && "md:hidden", className)}
      onClick={openSidebar}
    >
      <PanelLeft />
    </Button>
  );
}
