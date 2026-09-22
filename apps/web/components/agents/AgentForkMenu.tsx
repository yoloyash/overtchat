"use client";
import { Menu } from "@base-ui/react/menu";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentForkMenu({
  disabled,
  onFork,
}: {
  disabled: boolean;
  onFork: (chooseWorkspace: boolean) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button variant="ghost" size="icon-sm" />}
        disabled={disabled}
        aria-label="Fork from this response"
        title="Fork from this response"
      >
        <GitBranch className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup className="min-w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none">
            <Menu.Item
              onClick={() => onFork(false)}
              className="flex min-h-9 cursor-pointer items-center rounded-md px-2.5 outline-none data-[highlighted]:bg-accent"
            >
              Fork in new session
            </Menu.Item>
            <Menu.Item
              onClick={() => onFork(true)}
              className="flex min-h-9 cursor-pointer items-center rounded-md px-2.5 outline-none data-[highlighted]:bg-accent"
            >
              Fork in another workspace
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
