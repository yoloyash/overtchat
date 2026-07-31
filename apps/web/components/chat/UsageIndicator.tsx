"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleDollarSign } from "lucide-react";
import {
  getContextMeterValues,
  type ContextMeterValues,
} from "@/lib/chat/context-meter";
import { formatInteger } from "@/lib/chat/stats";
import { motionClasses } from "@/lib/motion";
import { formatNanoUsd, getCostCoverage } from "@/lib/usage/cost";
import type { UsageTotals } from "@/lib/usage/types";
import { cn } from "@/lib/utils";

interface ContextUsage {
  usedTokens: number;
  contextWindow?: number;
}

interface UsageIndicatorProps {
  contextUsage?: ContextUsage;
  sessionUsage?: UsageTotals;
}

function contextTone(values: ContextMeterValues): string {
  if (values.critical) return "text-destructive";
  if (values.warning) return "text-[var(--context-warning)]";
  return "text-muted-foreground";
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function UsageIndicator({
  contextUsage,
  sessionUsage,
}: UsageIndicatorProps) {
  const context = contextUsage
    ? getContextMeterValues(
        contextUsage.usedTokens,
        contextUsage.contextWindow,
      )
    : undefined;
  const session =
    sessionUsage &&
    sessionUsage.generations > 0 &&
    sessionUsage.pricedGenerations > 0
      ? sessionUsage
      : undefined;

  if (!context && !session) return null;

  const coverage = session ? getCostCoverage(session) : undefined;
  const cost = session ? formatNanoUsd(session.totalCostNanoUsd) : undefined;
  const visibleCost =
    cost && coverage === "partial" ? `${cost}+` : cost;
  const contextValue = context
    ? context.percentage === undefined
      ? "?"
      : `${context.percentage}%`
    : undefined;
  const triggerDetails = [
    context
      ? context.percentage === undefined
        ? "context limit unknown"
        : `${context.percentage}% context used`
      : undefined,
    session && cost
      ? coverage === "partial"
        ? `known session cost ${cost}`
        : `session cost ${cost}`
      : undefined,
  ].filter(Boolean);

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={`Usage: ${triggerDetails.join("; ")}. Show details`}
        title="Usage"
        className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium tabular-nums text-muted-foreground outline-none motion-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-accent data-[popup-open]:text-foreground max-md:h-9"
      >
        {context ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              contextTone(context),
            )}
          >
            <ContextRing values={context} />
            <span>{contextValue}</span>
          </span>
        ) : null}
        {context && session ? (
          <span aria-hidden="true" className="mx-2 h-4 w-px bg-border" />
        ) : null}
        {session ? (
          <span className="inline-flex items-center gap-1.5">
            <CircleDollarSign className="size-4" />
            <span>{visibleCost}</span>
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            className={cn(
              "w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-4 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="mb-4 text-sm font-semibold text-foreground">
              Usage
            </Popover.Title>

            {context ? (
              <section aria-label="Context">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-medium text-foreground">Context</h3>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      contextTone(context),
                    )}
                  >
                    {contextValue}
                  </span>
                </div>
                {context.percentage !== undefined ? (
                  <>
                    <div
                      role="progressbar"
                      aria-label="Context used"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, context.percentage)}
                      aria-valuetext={`${context.percentage}% used`}
                      className={cn(
                        "mt-2 h-1.5 overflow-hidden rounded-full bg-muted",
                        contextTone(context),
                      )}
                    >
                      <div
                        className="h-full rounded-full bg-current"
                        style={{ width: `${context.ringPercentage}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-muted-foreground">
                      <span>{formatInteger(context.usedTokens)} used</span>
                      <span>
                        {formatInteger(context.remainingTokens ?? 0)} remaining
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 flex items-center justify-between gap-4 text-muted-foreground">
                    <span>{formatInteger(context.usedTokens)} tokens</span>
                    <span>Limit unknown</span>
                  </div>
                )}
              </section>
            ) : null}

            {session ? (
              <section
                aria-label="Session"
                className={cn(context && "mt-4 border-t pt-4")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium text-foreground">Session</h3>
                    <p className="mt-0.5 text-muted-foreground">
                      {formatInteger(session.totalTokens)} tokens
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-base font-semibold text-foreground">
                      {visibleCost}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {coverage === "partial" ? "Known cost" : "Cost"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow
                    label="Input"
                    value={formatInteger(session.inputTokens)}
                  />
                  <DetailRow
                    label="Output"
                    value={formatInteger(session.outputTokens)}
                  />
                  {session.cacheReadTokens > 0 ? (
                    <DetailRow
                      label="Cache read"
                      value={formatInteger(session.cacheReadTokens)}
                    />
                  ) : null}
                  {session.cacheWriteTokens > 0 ? (
                    <DetailRow
                      label="Cache write"
                      value={formatInteger(session.cacheWriteTokens)}
                    />
                  ) : null}
                </div>
              </section>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
