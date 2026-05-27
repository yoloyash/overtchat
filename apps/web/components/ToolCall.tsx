"use client";

import { useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  Globe,
  Link2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSearchPart, FetchUrlPart } from "@overtchat/shared";

export type { WebSearchPart, FetchUrlPart };

export function ToolCall({ part }: { part: WebSearchPart | FetchUrlPart }) {
  const [open, setOpen] = useState(false);
  const isSearch = part.type === "tool-web_search";

  const label = isSearch
    ? part.input?.query?.trim() || "Searching…"
    : part.input?.url || "Fetching…";

  const status =
    part.state === "output-available"
      ? "done"
      : part.state === "output-error"
        ? "error"
        : "running";

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {status === "running" && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {status === "done" &&
          (isSearch ? (
            <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
          ))}
        {status === "error" && (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        )}
        <span className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {isSearch ? "Search" : "Read"}
          </span>{" "}
          · {label}
        </span>
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t px-3 py-2 text-xs">
          {part.state === "output-error" && (
            <p className="text-destructive">{part.errorText}</p>
          )}

          {isSearch && part.state === "output-available" && part.output && (
            <ul className="space-y-2">
              {part.output.map((r, i) => (
                <li key={i}>
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground hover:underline"
                  >
                    {r.title}
                  </a>
                  <p className="truncate text-muted-foreground">{r.link}</p>
                  {r.snippet && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {r.snippet}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!isSearch && part.state === "output-available" && part.output && (
            <div className="space-y-0.5">
              <a
                href={part.output.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground hover:underline"
              >
                {part.output.title}
              </a>
              <p className="text-muted-foreground">
                {part.output.wordCount.toLocaleString()} words
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
