"use client";

import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, Folder, Ghost } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  scheduledTaskName,
  contextUsage,
  sessionUsage,
  imageUsage,
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
  /** The scheduled task whose run started the chat: a way back to its page. */
  scheduledTaskName?: string;
  contextUsage?: { usedTokens: number; contextWindow?: number };
  sessionUsage?: UsageTotals;
  imageUsage?: UsageTotals;
  showTempToggle: boolean;
  temporary: boolean;
  onToggleTemporary: () => void;
  shareChatId?: string;
  sharingDisabled?: boolean;
  /** Toggles the panel with the conversation's files when it has any. */
  files?: { count: number; open: boolean; onToggle: () => void };
}) {
  const { t } = useTranslation();
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
        {scheduledTaskName && (
          <>
            <Link
              to="/scheduled"
              title={t("chat.header.scheduledTitle", { name: scheduledTaskName })}
              aria-label={t("chat.header.scheduledLabel", { name: scheduledTaskName })}
              data-scheduled-origin
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground motion-colors hover:bg-accent hover:text-foreground"
            >
              <CalendarClock className="size-3.5 shrink-0" />
              {/* Beside a project there is room for the mark alone. */}
              {!project && <span>{t("chat.header.scheduled")}</span>}
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
          imageUsage={imageUsage}
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
              temporary
                ? t("chat.header.disableTemporary")
                : t("chat.header.enableTemporary")
            }
            aria-pressed={temporary}
            title={t("chat.header.temporaryTooltip")}
          >
            <Ghost />
          </Button>
        ) : temporary ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground">
            <Ghost className="size-3.5" />
            {t("chat.header.temporaryBadge")}
          </span>
        ) : null}
      </div>
    </header>
  );
}
