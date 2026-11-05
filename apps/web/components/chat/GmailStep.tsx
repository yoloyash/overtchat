"use client";

import { Paperclip } from "lucide-react";
import {
  describeGmailToolPart,
  type GmailToolPart,
  type GmailToolRow,
} from "@overtchat/shared";
import { cn } from "@/lib/utils";

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One Gmail tool call in the activity timeline: what was searched, read or
 * sorted, with senders and subjects but never message bodies. A saved draft
 * is not a step; it shows as its own card.
 */
export function GmailStep({ part }: { part: GmailToolPart }) {
  const display = describeGmailToolPart(part);

  const running = display.status === "running";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {display.detail ?? (running ? `${display.title}…` : display.title)}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {display.status === "error"
            ? "Failed"
            : running
              ? display.detail && `${display.title}…`
              : display.note}
        </span>
      </div>
      {display.error ? (
        <p className="text-destructive">{display.error}</p>
      ) : (
        display.rows.length > 0 && (
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border bg-background/40">
            {display.rows.map((row, index) => (
              <li key={index}>
                <MessageRow row={row} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** Sender, then subject or attachments, then date: the columns of an inbox. */
function MessageRow({ row }: { row: GmailToolRow }) {
  const content = (
    <>
      <span
        className={cn(
          "w-[30%] max-w-44 shrink-0 truncate text-foreground",
          row.unread && "font-medium",
        )}
      >
        {row.sender || "(unknown sender)"}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5",
          row.unread ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {row.attachments && <Paperclip className="size-3 shrink-0" />}
        <span className="truncate">
          {row.subject ?? row.attachments?.join(", ")}
        </span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {shortDate(row.date)}
      </span>
    </>
  );
  const className = "flex items-center gap-2.5 px-2.5 py-2";
  return row.href ? (
    <a
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Gmail"
      className={cn(className, "motion-colors hover:bg-accent/60")}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
