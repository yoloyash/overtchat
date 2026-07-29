"use client";

import { Popover } from "@base-ui/react/popover";
import {
  getContextMeterValues,
  type ContextMeterValues,
} from "@/lib/chat/context-meter";
import { formatInteger } from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ContextMeterProps {
  usedTokens: number;
  contextWindow?: number;
}

function ContextRing({ values }: { values: ContextMeterValues }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        className="fill-none stroke-border"
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r="7.5"
        pathLength="100"
        className="fill-none stroke-current"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="100"
        strokeDashoffset={100 - values.ringPercentage}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function ContextMeter({
  usedTokens,
  contextWindow,
}: ContextMeterProps) {
  const values = getContextMeterValues(usedTokens, contextWindow);
  const limitKnown = values.contextWindow !== undefined;
  const visibleValue = limitKnown ? `${values.percentage}%` : "?";
  const triggerLabel = limitKnown
    ? `Context usage: ${values.percentage}% used. Show details`
    : "Context usage: limit unknown. Show details";

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={triggerLabel}
        title="Context usage"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-xs font-medium tabular-nums outline-none motion-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-accent max-md:h-9 max-md:px-2.5",
          values.critical
            ? "text-destructive"
            : values.warning
              ? "text-[var(--context-warning)]"
            : "text-muted-foreground hover:text-foreground data-[popup-open]:text-foreground",
        )}
      >
        <ContextRing values={values} />
        <span>{visibleValue}</span>
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
              "z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="mb-2 font-medium text-foreground">
              Context usage
            </Popover.Title>
            <div className="space-y-2">
              <ContextRow
                label="Used"
                value={formatInteger(values.usedTokens)}
              />
              <ContextRow
                label="Maximum"
                value={
                  values.contextWindow === undefined
                    ? "Unknown"
                    : formatInteger(values.contextWindow)
                }
              />
              <ContextRow
                label="Remaining"
                value={
                  values.remainingTokens === undefined
                    ? "Unknown"
                    : formatInteger(values.remainingTokens)
                }
              />
            </div>
            {!limitKnown ? (
              <Popover.Description className="mt-3 border-t pt-3 leading-relaxed text-muted-foreground">
                Context limit unknown for this model. An admin can set it in
                Settings → Models.
              </Popover.Description>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
