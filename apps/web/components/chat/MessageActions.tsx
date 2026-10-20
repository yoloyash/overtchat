"use client";

import { cn } from "@/lib/utils";

export function MessageActions({
  show,
  alwaysVisible = false,
  children,
}: {
  show: boolean;
  alwaysVisible?: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div
      data-slot="message-actions"
      className={cn(
        "flex items-center gap-0.5",
        !alwaysVisible &&
          "opacity-0 motion-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      {children}
    </div>
  );
}

export function MessageActionButton({
  label,
  icon,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground motion-colors hover:bg-accent hover:text-foreground max-md:p-2.5 disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
