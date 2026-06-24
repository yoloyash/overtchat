"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import {
  formatDuration,
  formatInteger,
  formatTps,
  type MessageStats,
} from "@/lib/chat/stats";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";

export function StatsPopover({ stats }: { stats: MessageStats }) {
  const rows = [
    stats.providerLabel !== undefined
      ? {
          iconId: stats.providerIconId,
          label: "Provider",
          value: stats.providerLabel,
        }
      : null,
    stats.model !== undefined
      ? {
          iconId: stats.modelIconId ?? stats.providerIconId,
          label: "Model",
          value: stats.model,
        }
      : null,
    stats.contextTokens !== undefined
      ? { label: "Context tokens", value: formatInteger(stats.contextTokens) }
      : null,
    stats.responseTokens !== undefined
      ? { label: "Response tokens", value: formatInteger(stats.responseTokens) }
      : null,
    stats.totalTokens !== undefined
      ? { label: "Total tokens", value: formatInteger(stats.totalTokens) }
      : null,
    stats.ttftMs !== undefined
      ? { label: "TTFT", value: formatDuration(stats.ttftMs) }
      : null,
    stats.tps !== undefined ? { label: "TPS", value: formatTps(stats.tps) } : null,
    stats.finishReason !== undefined
      ? { label: "Finish reason", value: stats.finishReason }
      : null,
  ].filter(
    (
      row,
    ): row is {
      iconId?: MessageStats["providerIconId"];
      label: string;
      value: string;
    } => row !== null,
  );

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
              {rows.map(({ iconId, label, value }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-foreground">
                    <ModelBrandIcon iconId={iconId} className="size-3.5" />
                    <span className="truncate">{value}</span>
                  </span>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
