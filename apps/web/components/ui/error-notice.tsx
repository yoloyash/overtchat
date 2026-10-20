"use client";

import type { ReactNode } from "react";
import { AlertCircle, X } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Persistent feedback beside the failed operation. Actions remain owned by the caller. */
export function ErrorNotice({
  message,
  fallback,
  title,
  actions,
  onDismiss,
  className,
}: {
  // Strings are display copy supplied by the caller; exceptions are normalized.
  message: unknown;
  fallback?: string;
  title?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm",
        className,
      )}
    >
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="space-y-1 break-words [overflow-wrap:anywhere]">
          {title && <p className="font-medium text-foreground">{title}</p>}
          <p className="text-foreground">
            {typeof message === "string" ? message : getErrorMessage(message, fallback)}
          </p>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss error"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
