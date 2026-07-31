"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleDollarSign } from "lucide-react";
import { formatInteger } from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
import {
  formatNanoUsd,
  getCostCoverage,
  type CostCoverage,
} from "@/lib/usage/cost";
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

function descriptionFor(usage: UsageTotals, coverage: CostCoverage): string {
  if (coverage === "complete") {
    return "Based on models.dev rates captured at generation time. Includes assistant responses and title generation; provider billing may differ.";
  }
  if (coverage === "partial") {
    return `${formatInteger(usage.pricedGenerations)} of ${formatInteger(usage.generations)} model calls had known pricing. The shown subtotal excludes unpriced calls and may be lower than provider billing.`;
  }
  return "Pricing was unavailable for these model calls. Token usage still includes assistant responses and title generation.";
}

export function SessionUsage({ usage }: { usage: UsageTotals }) {
  if (usage.generations <= 0) return null;

  const coverage = getCostCoverage(usage);
  const cost =
    coverage === "unavailable"
      ? "Unavailable"
      : formatNanoUsd(usage.totalCostNanoUsd);
  const visibleCost =
    coverage === "unavailable"
      ? "--"
      : `~${cost}${coverage === "partial" ? "+" : ""}`;
  const triggerLabel =
    coverage === "complete"
      ? `Estimated session cost: ${cost}. Show details`
      : coverage === "partial"
        ? `Partial session cost estimate: ${cost} from ${usage.pricedGenerations} of ${usage.generations} model calls. Show details`
        : "Session cost unavailable. Show details";

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
                label={
                  coverage === "partial"
                    ? "Known cost"
                    : "Estimated cost"
                }
                value={coverage === "partial" ? `${cost}+` : cost}
              />
              <UsageRow
                label="Model calls"
                value={formatInteger(usage.generations)}
              />
              <UsageRow
                label="Total tokens"
                value={formatInteger(usage.totalTokens)}
              />
              <UsageRow
                label="Pricing coverage"
                value={`${formatInteger(usage.pricedGenerations)} of ${formatInteger(usage.generations)}`}
              />
            </div>
            {coverage !== "unavailable" ? (
              <div className="mt-3 space-y-2 border-t pt-3">
                <UsageRow
                  label="Input"
                  value={formatNanoUsd(usage.inputCostNanoUsd)}
                />
                <UsageRow
                  label="Output"
                  value={formatNanoUsd(usage.outputCostNanoUsd)}
                />
                <UsageRow
                  label="Cache read"
                  value={formatNanoUsd(usage.cacheReadCostNanoUsd)}
                />
                <UsageRow
                  label="Cache write"
                  value={formatNanoUsd(usage.cacheWriteCostNanoUsd)}
                />
              </div>
            ) : null}
            <Popover.Description className="mt-3 border-t pt-3 leading-relaxed text-muted-foreground">
              {descriptionFor(usage, coverage)}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
