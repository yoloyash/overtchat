"use client";

import { Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/components/ModelPicker";
import { SidebarToggle } from "@/components/SidebarToggle";
import type { PublicModelConfig } from "@/lib/model-config/schema";
import type { UsageTotals } from "@/lib/usage/types";
import { UsageIndicator } from "./UsageIndicator";

export function ChatHeader({
  models,
  selectedId,
  onSelectModel,
  contextUsage,
  sessionUsage,
  showTempToggle,
  temporary,
  onToggleTemporary,
}: {
  models: PublicModelConfig[] | null;
  selectedId: string;
  onSelectModel: (id: string) => void;
  contextUsage?: { usedTokens: number; contextWindow?: number };
  sessionUsage?: UsageTotals;
  showTempToggle: boolean;
  temporary: boolean;
  onToggleTemporary: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <SidebarToggle />
      <ModelPicker
        models={models}
        selectedId={selectedId}
        onSelect={onSelectModel}
      />
      <div className="ml-auto flex items-center">
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
