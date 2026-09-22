"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Undo2, Loader2 } from "lucide-react";
import type { AgentRewindMode } from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";

export function AgentRewindMenu({
  options,
  disabled,
  onRewind,
}: {
  options: Array<{ mode: AgentRewindMode; label: string }>;
  disabled: boolean;
  onRewind: (mode: AgentRewindMode) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AgentRewindMode | null>(null);
  if (!options.length) return null;
  return (
    <Menu.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <Menu.Trigger
        render={<Button variant="ghost" size="icon-sm" />}
        className="opacity-0 motion-opacity group-hover/user:opacity-100 group-focus-within/user:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
        disabled={disabled || !!pending}
        aria-label="Rewind to this message"
        title="Rewind to this message"
      >
        <Undo2 className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup className="min-w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none">
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              This action cannot be undone
            </p>
            <Menu.Separator className="my-1 h-px bg-border" />
            {options.map(({ mode, label }) => (
              <Menu.Item
                key={mode}
                closeOnClick={false}
                disabled={disabled || !!pending}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
                onClick={async () => {
                  if (pending) return;
                  setPending(mode);
                  try {
                    await onRewind(mode);
                  } finally {
                    setPending(null);
                    setOpen(false);
                  }
                }}
              >
                {pending === mode && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
