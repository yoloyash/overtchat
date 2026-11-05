"use client";

import { describeGmailToolPart, type GmailToolPart } from "@overtchat/shared";

const VISIBLE_ROWS = 5;

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One Gmail tool call in the activity timeline: what was searched, read, or
 * drafted, with senders and subjects but never message bodies.
 */
export function GmailStep({ part }: { part: GmailToolPart }) {
  const display = describeGmailToolPart(part);
  const rows = display.rows.slice(0, VISIBLE_ROWS);
  const hidden = display.rows.length - rows.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {display.detail ?? display.title}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {display.status === "error"
            ? "Failed"
            : display.status === "running"
              ? `${display.title}…`
              : (display.note ?? display.title)}
        </span>
      </div>
      {display.error ? (
        <p className="text-destructive">{display.error}</p>
      ) : (
        rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((row, index) => (
              <li key={index} className="flex items-baseline gap-2">
                <span
                  className={
                    row.unread
                      ? "min-w-0 truncate font-medium text-foreground"
                      : "min-w-0 truncate text-foreground"
                  }
                >
                  {row.primary}
                </span>
                {row.secondary && (
                  <span className="min-w-0 shrink truncate text-muted-foreground">
                    {row.secondary}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {shortDate(row.date)}
                </span>
              </li>
            ))}
            {hidden > 0 && (
              <li className="text-muted-foreground">+{hidden} more</li>
            )}
          </ul>
        )
      )}
      {display.href && (
        <a
          href={display.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-foreground underline underline-offset-4"
        >
          Open drafts in Gmail
        </a>
      )}
    </div>
  );
}
