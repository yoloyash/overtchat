"use client";

import { Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarToggle } from "@/components/SidebarToggle";
import type { UsageTotals } from "@/lib/usage/types";
import { UsageIndicator } from "./UsageIndicator";

export function ChatHeader({
  title,
  contextUsage,
  sessionUsage,
  showTempToggle,
  temporary,
  onToggleTemporary,
}: {
  title: string | null;
  contextUsage?: { usedTokens: number; contextWindow?: number };
  sessionUsage?: UsageTotals;
  showTempToggle: boolean;
  temporary: boolean;
  onToggleTemporary: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <SidebarToggle />
      {title ? (
        <h1
          className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
          title={title}
        >
          {title}
        </h1>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex shrink-0 items-center">
        <UsageIndicator
          contextUsage={contextUsage}
          sessionUsage={sessionUsage}
        />
        {showTempToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "rounded-full",
              temporary && "bg-accent text-foreground hover:bg-accent",
            )}
            onClick={onToggleTemporary}
            aria-label={
              temporary ? "Disable temporary chat" : "Enable temporary chat"
            }
            aria-pressed={temporary}
            title="Temporary chat — won't be saved to history"
          >
            <Ghost />
          </Button>
        ) : temporary ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground">
            <Ghost className="size-3.5" />
            Temporary
          </span>
        ) : null}
      </div>
    </header>
  );
}
