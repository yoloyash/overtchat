"use client";

import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** Pulses while the router is loading the page at `to`. */
export function LinkPendingIndicator({
  to,
  className,
}: {
  to: string;
  className?: string;
}) {
  const pending = useRouterState({
    select: (state) =>
      state.status === "pending" && state.location.pathname === to,
  });

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
