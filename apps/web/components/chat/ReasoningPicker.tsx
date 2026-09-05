"use client";

import { Menu } from "@base-ui/react/menu";
import type {
  ChatReasoningLevel,
  ModelReasoningControls,
  ModelReasoningLevel,
} from "@overtchat/shared";
import { Brain, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ReasoningPicker({
  controls,
  value,
  onChange,
}: {
  controls: ModelReasoningControls | undefined;
  value: ChatReasoningLevel;
  onChange: (level: ChatReasoningLevel) => void;
}) {
  if (!controls) return null;

  const effectiveValue =
    value === "default" ? controls.defaultLevel : value;
  const rawOptions: ModelReasoningLevel[] = [];
  if (controls.efforts?.length) {
    if (controls.toggle) rawOptions.push("off");
    if (controls.defaultLevel === "on") rawOptions.push("on");
    rawOptions.push(...controls.efforts);
  } else if (controls.toggle) {
    rawOptions.push("on", "off");
  }
  const options = [...new Set(rawOptions)];

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1.5 px-2"
            aria-label={`Thinking: ${effectiveValue}`}
          />
        }
      >
        <Brain className="size-4" />
        <span className="hidden sm:inline">
          {effectiveValue}
          {effectiveValue === controls.defaultLevel ? " (default)" : ""}
        </span>
        <ChevronDown className="hidden text-muted-foreground sm:block" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6}>
          <Menu.Popup
            aria-label="Thinking level"
            className={cn(
              "z-50 w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            {options.map((option) => (
              <Menu.Item
                key={option}
                onClick={() => onChange(option)}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                  option === effectiveValue &&
                    "bg-accent text-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1">
                  {option}
                  {option === controls.defaultLevel ? " (default)" : ""}
                </span>
                <span className="flex size-4 items-center justify-center">
                  {option === effectiveValue ? (
                    <Check className="size-3.5" />
                  ) : null}
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
