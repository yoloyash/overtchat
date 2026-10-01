"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  ACTIVITY_PERIODS,
  type ActivityPeriod,
  type ActivityTotals,
} from "@/lib/activity/types";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useActivityLeaderboard } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";
import { ActivityMetric } from "./ActivityMetric";
import { formatCompact, formatDate, formatExact } from "./activity-format";

const PERIOD_LABELS: Record<ActivityPeriod, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

const EMPTY_TOTALS: ActivityTotals = {
  generations: 0,
  pricedGenerations: 0,
  inputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  inputCostNanoUsd: 0,
  outputCostNanoUsd: 0,
  cacheReadCostNanoUsd: 0,
  cacheWriteCostNanoUsd: 0,
  totalCostNanoUsd: 0,
};

export function ActivityLeaderboard() {
  const [period, setPeriod] = useState<ActivityPeriod>("30d");
  const { data, isPending, isError } = useActivityLeaderboard(period);
  const totals = (data?.entries ?? []).reduce<ActivityTotals>(
    (sum, entry) => ({
      generations: sum.generations + entry.generations,
      pricedGenerations: sum.pricedGenerations + entry.pricedGenerations,
      inputTokens: sum.inputTokens + entry.inputTokens,
      uncachedInputTokens:
        sum.uncachedInputTokens + entry.uncachedInputTokens,
      outputTokens: sum.outputTokens + entry.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + entry.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + entry.cacheWriteTokens,
      totalTokens: sum.totalTokens + entry.totalTokens,
      inputCostNanoUsd:
        sum.inputCostNanoUsd + entry.inputCostNanoUsd,
      outputCostNanoUsd:
        sum.outputCostNanoUsd + entry.outputCostNanoUsd,
      cacheReadCostNanoUsd:
        sum.cacheReadCostNanoUsd + entry.cacheReadCostNanoUsd,
      cacheWriteCostNanoUsd:
        sum.cacheWriteCostNanoUsd + entry.cacheWriteCostNanoUsd,
      totalCostNanoUsd:
        sum.totalCostNanoUsd + entry.totalCostNanoUsd,
    }),
    EMPTY_TOTALS,
  );
  const activePeople =
    data?.entries.filter((entry) => entry.generations > 0).length ?? 0;

  return (
    <div className="@container mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 @xl:flex-row @xl:items-end @xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Leaderboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.trackingStartedAt
              ? `Tracking since ${formatDate(data.trackingStartedAt)}`
              : "Waiting for the first tracked response"}
          </p>
        </div>
        <div
          role="group"
          aria-label="Leaderboard period"
          className="grid grid-cols-3 rounded-lg border border-border/70 bg-muted/50 p-1"
        >
          {ACTIVITY_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-w-20 rounded-md px-3 py-2 text-xs font-medium motion-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                period === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PERIOD_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-7 grid grid-cols-3 gap-2 sm:gap-3">
        <ActivityMetric
          label="Chat tokens"
          value={isError ? undefined : totals.totalTokens}
          pending={isPending}
        />
        <ActivityMetric
          label="Responses"
          value={isError ? undefined : totals.generations}
          pending={isPending}
        />
        <ActivityMetric
          label="Active people"
          value={isError ? undefined : activePeople}
          pending={isPending}
        />
      </dl>

      <section className="mt-9">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">People</h2>
          <span className="text-xs text-muted-foreground">Ranked by chat tokens</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_6rem_5.5rem_5.5rem_5.5rem_1.5rem] items-center border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground @3xl:grid">
            <span>Rank</span>
            <span>Person</span>
            <span className="text-right">Chat tokens</span>
            <span className="text-right">Responses</span>
            <span className="text-right">Input</span>
            <span className="text-right">Output</span>
            <span />
          </div>

          {isPending ? (
            <LeaderboardSkeleton />
          ) : isError ? (
            <p className="px-3 py-10 text-center text-sm text-destructive">
              Activity could not be loaded.
            </p>
          ) : data?.entries.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No activity to show for this period.
            </p>
          ) : (
            data?.entries.map((entry, index) => (
              <Link
                key={entry.userId}
                href={`/activity/${entry.userId}`}
                className="group grid min-h-20 grid-cols-[2.25rem_minmax(0,1fr)_auto_1.25rem] items-center gap-2 border-b border-border/60 px-4 py-4 motion-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring last:border-b-0 hover:bg-muted/45 @3xl:grid-cols-[2.5rem_minmax(0,1fr)_6rem_5.5rem_5.5rem_5.5rem_1.5rem] @3xl:gap-0"
              >
                <span
                  aria-label={`Rank ${index + 1}`}
                  className="text-center text-xs tabular-nums text-muted-foreground"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar
                    id={entry.userId}
                    name={entry.name}
                    image={entry.image}
                    tone="muted"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {entry.name}
                    </span>
                    <span className="block text-xs text-muted-foreground @3xl:hidden">
                      {formatCompact(entry.generations)} responses
                    </span>
                  </span>
                </span>
                <Value value={entry.totalTokens} />
                <span className="hidden text-right text-sm tabular-nums text-muted-foreground @3xl:block">
                  {formatCompact(entry.generations)}
                </span>
                <span className="hidden text-right text-sm tabular-nums text-muted-foreground @3xl:block">
                  {formatCompact(entry.inputTokens)}
                </span>
                <span className="hidden text-right text-sm tabular-nums text-muted-foreground @3xl:block">
                  {formatCompact(entry.outputTokens)}
                </span>
                <ChevronRight className="size-4 text-muted-foreground/50 motion-colors group-hover:text-foreground" />
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Value({ value }: { value: number }) {
  return (
    <span
      className="text-right text-sm font-semibold tabular-nums"
      title={`${formatExact(value)} chat tokens`}
    >
      {formatCompact(value)}
    </span>
  );
}

function LeaderboardSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex h-20 items-center gap-3 border-b px-4 last:border-b-0"
        >
          <div className="h-4 w-5 rounded motion-skeleton" />
          <div className="size-9 rounded-full motion-skeleton" />
          <div className="h-4 w-32 rounded motion-skeleton" />
          <div className="ml-auto h-4 w-16 rounded motion-skeleton" />
        </div>
      ))}
    </>
  );
}
