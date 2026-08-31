"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeMemoryToolPart,
  memoryToolArtifactLabel,
  memoryToolStatusLabel,
  type MemoryToolDisplay,
  type MemoryToolPart,
} from "@overtchat/shared";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function MemoryArtifact({ parts }: { parts: MemoryToolPart[] }) {
  const [open, setOpen] = useState(false);
  const details = parts.map(describeMemoryToolPart);
  const running = details.some((detail) => detail.status === "running");
  const failed = details.some((detail) => detail.status === "error");
  const incomplete = details.some(
    (detail) => detail.status === "missing" || detail.status === "incomplete",
  );
  const Icon: LucideIcon = running
    ? Loader2
    : failed || incomplete
      ? CircleAlert
      : Check;

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/20 text-xs">
      <div className="flex min-h-10 items-center gap-1 px-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="group/memory flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full",
              failed
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            <Icon
              className={cn("size-3", running && motionClasses.spinner)}
            />
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {memoryToolArtifactLabel(details)}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground motion-transform",
              open && "rotate-180",
            )}
          />
        </button>
        <Button
          render={<Link href="/settings/personalization" />}
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
        >
          Manage
        </Button>
      </div>

      <div
        className={cn(
          "grid",
          motionClasses.collapse,
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="divide-y border-t px-3">
            {details.map((detail, index) => (
              <MemoryDetail
                key={`${detail.action}:${detail.key ?? "memory"}:${index}`}
                detail={detail}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryDetail({ detail }: { detail: MemoryToolDisplay }) {
  const status = memoryToolStatusLabel(detail);
  return (
    <div className="space-y-1.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <code className="min-w-0 truncate text-[11px] text-muted-foreground">
          {detail.key ?? "Memory"}
        </code>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            detail.status === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
      {detail.value && (
        <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">
          {detail.value}
        </p>
      )}
      {detail.error && <p className="text-destructive">{detail.error}</p>}
    </div>
  );
}
