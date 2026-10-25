"use client";

import { useEffect, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The frame of a panel beside the chat: docked beside it on wide screens and
 * full screen otherwise; `overlay` floats it everywhere. Escape closes it from
 * anywhere unless something else handles the key.
 */
export function SidePanel({
  variant,
  onClose,
  className,
  ...props
}: ComponentProps<"aside"> & { variant: "docked" | "overlay"; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        target?.closest("[role=dialog]")
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      {...props}
      className={cn(
        "z-40 flex min-h-0 flex-col bg-background text-foreground",
        variant === "docked"
          ? "fixed inset-0 lg:static lg:z-auto lg:w-[min(46rem,48%)] lg:shrink-0 lg:border-l"
          : "fixed inset-0 lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[min(46rem,60%)] lg:border-l lg:shadow-xl",
        className,
      )}
    />
  );
}
