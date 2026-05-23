"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import {
  formatDuration,
  formatInteger,
  formatTps,
  type MessageStats,
} from "@/lib/chat/stats";

export function StatsPopover({ stats }: { stats: MessageStats }) {
  const rows = [
    stats.contextTokens !== undefined
      ? ["Context tokens", formatInteger(stats.contextTokens)]
      : null,
    stats.responseTokens !== undefined
      ? ["Response tokens", formatInteger(stats.responseTokens)]
      : null,
    stats.totalTokens !== undefined
      ? ["Total tokens", formatInteger(stats.totalTokens)]
      : null,
    stats.ttftMs !== undefined ? ["TTFT", formatDuration(stats.ttftMs)] : null,
    stats.tps !== undefined ? ["TPS", formatTps(stats.tps)] : null,
    stats.finishReason !== undefined ? ["Finish reason", stats.finishReason] : null,
  ].filter((row): row is [string, string] => row !== null);

  if (!rows.length) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label="Stats for nerds"
        title="Stats for nerds"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:p-2.5"
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6}>
          <Popover.Popup className="z-50 w-56 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none">
            <div className="space-y-2">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
