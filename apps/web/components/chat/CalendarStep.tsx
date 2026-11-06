"use client";

import { Users } from "lucide-react";
import {
  describeCalendarToolPart,
  formatCalendarEventTime,
  type CalendarEventRow,
  type CalendarToolPart,
} from "@overtchat/shared";
import { cn } from "@/lib/utils";

/**
 * One Google Calendar tool call in the activity timeline: the events that
 * were listed, or the one that was added, changed or deleted, with times and
 * titles but never descriptions.
 */
export function CalendarStep({ part }: { part: CalendarToolPart }) {
  const display = describeCalendarToolPart(part);
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
                <EventRow row={row} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** When, then what and where, then how many guests: the columns of an agenda. */
function EventRow({ row }: { row: CalendarEventRow }) {
  const content = (
    <>
      <span className="w-[42%] max-w-60 shrink-0 truncate tabular-nums text-muted-foreground">
        {formatCalendarEventTime(row)}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span
          className={cn(
            "truncate text-foreground",
            row.gone && "text-muted-foreground line-through",
          )}
        >
          {row.title}
        </span>
        {row.location && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {row.location}
          </span>
        )}
      </span>
      {row.guests > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground"
          title={`${row.guests} ${row.guests === 1 ? "guest" : "guests"}`}
        >
          <Users className="size-3" />
          {row.guests}
        </span>
      )}
    </>
  );
  const className = "flex items-center gap-2.5 px-2.5 py-2";
  return row.href ? (
    <a
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Google Calendar"
      className={cn(className, "motion-colors hover:bg-accent/60")}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
