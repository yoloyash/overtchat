"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

export function LinkPendingIndicator({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto size-1.5 shrink-0 rounded-full bg-current opacity-0 motion-opacity",
        pending && "animate-pulse opacity-60 motion-reduce:animate-none",
        className,
      )}
    />
  );
}
