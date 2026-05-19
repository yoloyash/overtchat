"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { UIMessage } from "ai";
import { cleanDomain, faviconUrl, type WebSearchResult } from "@/lib/web-client";
import type { WebSearchPart } from "@/components/ToolCall";
import { cn } from "@/lib/utils";

export function Sources({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);

  const all: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const part of message.parts) {
    const sp = part as unknown as WebSearchPart;
    if (sp.type !== "tool-web_search") continue;
    const results = sp.output;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (seen.has(r.link)) continue;
      seen.add(r.link);
      all.push(r);
    }
  }
  if (all.length === 0) return null;

  const preview = all.slice(0, 5);

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <div className="flex -space-x-1">
          {preview.map((r) => {
            const domain = cleanDomain(r.link);
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={r.link}
                src={faviconUrl(domain)}
                alt=""
                loading="lazy"
                className="size-4 rounded-full border border-background bg-background"
              />
            );
          })}
        </div>
        <span className="font-medium">{all.length} Sources</span>
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <ol className="mt-2 space-y-2">
          {all.map((r, i) => {
            const domain = cleanDomain(r.link);
            return (
              <li key={r.link} className="flex gap-2">
                <span className="w-5 shrink-0 text-right text-muted-foreground">
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-1 font-medium text-foreground hover:underline"
                  >
                    {r.title}
                  </a>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={faviconUrl(domain)}
                      alt=""
                      loading="lazy"
                      className="size-3 rounded-full"
                    />
                    <span className="truncate">{domain}</span>
                  </div>
                  {r.snippet && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {r.snippet}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
