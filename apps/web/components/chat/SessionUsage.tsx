"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleDollarSign } from "lucide-react";
import { formatInteger } from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
import { formatNanoUsd, getCostCoverage } from "@/lib/usage/cost";
import type { UsageTotals } from "@/lib/usage/types";
import { cn } from "@/lib/utils";

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function SessionUsage({ usage }: { usage: UsageTotals }) {
  if (usage.generations <= 0 || usage.pricedGenerations <= 0) return null;

  const coverage = getCostCoverage(usage);
  const cost = formatNanoUsd(usage.totalCostNanoUsd);
  const visibleCost = `${cost}${coverage === "partial" ? "+" : ""}`;
  const triggerLabel =
    coverage === "complete"
      ? `Session cost: ${cost}. Show details`
      : `Known session cost: ${cost} from ${usage.pricedGenerations} of ${usage.generations} model calls. Show details`;

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={triggerLabel}
        title="Session usage"
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-xs font-medium tabular-nums text-muted-foreground outline-none motion-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-accent data-[popup-open]:text-foreground max-md:h-9 max-md:px-2.5"
      >
        <CircleDollarSign className="size-4" />
        <span>{visibleCost}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          <Popover.Popup
            className={cn(
              "z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="mb-2 font-medium text-foreground">
              Session usage
            </Popover.Title>
            <div className="space-y-2">
              <UsageRow
                label="Input"
                value={formatInteger(usage.inputTokens)}
              />
              {usage.cacheReadTokens > 0 ? (
                <UsageRow
                  label="Cache read"
                  value={formatInteger(usage.cacheReadTokens)}
                />
              ) : null}
              {usage.cacheWriteTokens > 0 ? (
                <UsageRow
                  label="Cache write"
                  value={formatInteger(usage.cacheWriteTokens)}
                />
              ) : null}
              <UsageRow
                label="Output"
                value={formatInteger(usage.outputTokens)}
              />
              <UsageRow
                label="Total"
                value={formatInteger(usage.totalTokens)}
              />
            </div>
            <div className="mt-3 space-y-2 border-t pt-3">
              <UsageRow
                label={coverage === "partial" ? "Known cost" : "Cost"}
                value={visibleCost}
              />
              {coverage === "partial" ? (
                <UsageRow
                  label="Pricing"
                  value={`${formatInteger(usage.pricedGenerations)} of ${formatInteger(usage.generations)} calls`}
                />
              ) : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
