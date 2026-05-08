"use client";

import { Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onOpenConfig: () => void;
  onNewChat: () => void;
}

export function Sidebar({ onOpenConfig, onNewChat }: Props) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold tracking-tight">overtchat</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          onClick={onNewChat}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Plus />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          No conversations yet
        </p>
      </div>

      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={onOpenConfig}
        >
          <Settings />
          <span>API settings</span>
        </Button>
      </div>
    </aside>
  );
}
