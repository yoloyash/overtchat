"use client";

import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder, Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarToggle } from "@/components/SidebarToggle";
import type { UsageTotals } from "@/lib/usage/types";
import { UsageIndicator } from "./UsageIndicator";
import { ChatFilesButton } from "./ChatFiles";
import { ShareChatButton } from "./ShareChatDialog";

export function ChatHeader({
  title,
  project,
  contextUsage,
  sessionUsage,
  showTempToggle,
  temporary,
  onToggleTemporary,
  shareChatId,
  sharingDisabled,
  files,
}: {
  title: string | null;
  /** Shown as a breadcrumb before the title for chats in a project. */
  project?: { id: string; name: string };
  contextUsage?: { usedTokens: number; contextWindow?: number };
  sessionUsage?: UsageTotals;
  showTempToggle: boolean;
  temporary: boolean;
  onToggleTemporary: () => void;
  shareChatId?: string;
  sharingDisabled?: boolean;
  /** Toggles the panel with the conversation's files when it has any. */
  files?: { count: number; open: boolean; onToggle: () => void };
}) {
  return (
    <header data-titlebar className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <SidebarToggle />
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {project && (
          <>
            <Link
              to="/projects/$id"
              params={{ id: project.id }}
              title={project.name}
              className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{project.name}</span>
            </Link>
            {title && (
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground/60"
              />
            )}
          </>
        )}
        {title && (
          <h1
            className="min-w-0 truncate px-1 text-sm font-medium"
            title={title}
          >
            {title}
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {files && files.count > 0 && <ChatFilesButton {...files} />}
        {shareChatId && <ShareChatButton chatId={shareChatId} disabled={sharingDisabled} />}
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
