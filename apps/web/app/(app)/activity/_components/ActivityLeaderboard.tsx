"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import {
  ACTIVITY_PERIODS,
  type ActivityPeriod,
  type ActivityTotals,
} from "@/lib/activity/types";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useActivityLeaderboard } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";
import { formatCompact, formatDate, formatExact } from "./activity-format";

const PERIOD_LABELS: Record<ActivityPeriod, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

const EMPTY_TOTALS: ActivityTotals = {
  generations: 0,
  inputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

export function ActivityLeaderboard() {
  const [period, setPeriod] = useState<ActivityPeriod>("30d");
  const { data, isPending, isError } = useActivityLeaderboard(period);
  const totals = (data?.entries ?? []).reduce<ActivityTotals>(
    (sum, entry) => ({
      generations: sum.generations + entry.generations,
      inputTokens: sum.inputTokens + entry.inputTokens,
      uncachedInputTokens:
        sum.uncachedInputTokens + entry.uncachedInputTokens,
      outputTokens: sum.outputTokens + entry.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + entry.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + entry.cacheWriteTokens,
      totalTokens: sum.totalTokens + entry.totalTokens,
    }),
    EMPTY_TOTALS,
  );
  const activePeople =
    data?.entries.filter((entry) => entry.generations > 0).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
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
          className="grid grid-cols-3 rounded-md bg-muted p-1"
        >
          {ACTIVITY_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-w-20 rounded px-3 py-1.5 text-xs font-medium motion-colors",
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

      <dl className="mt-8 grid grid-cols-3 divide-x border-y">
        <Metric label="Chat tokens" value={totals.totalTokens} />
        <Metric label="Responses" value={totals.generations} />
        <Metric label="Active people" value={activePeople} />
      </dl>

      <section className="mt-9">
        <h2 className="mb-3 text-sm font-semibold">People</h2>
        <div className="border-y">
          <div className="hidden grid-cols-[3rem_minmax(12rem,1fr)_8rem_7rem_8rem_8rem_1.5rem] items-center border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
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
          ) : (
            data?.entries.map((entry, index) => (
              <Link
                key={entry.userId}
                href={`/activity/${entry.userId}`}
                className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto_1.25rem] items-center gap-2 border-b px-3 py-2.5 motion-colors last:border-b-0 hover:bg-muted/45 md:grid-cols-[3rem_minmax(12rem,1fr)_8rem_7rem_8rem_8rem_1.5rem] md:gap-0"
              >
                <Rank
                  value={index + 1}
                  active={entry.generations > 0}
                />
                <span className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar
                    id={entry.userId}
                    name={entry.name}
                    image={entry.image}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {entry.name}
                    </span>
                    <span className="block text-xs text-muted-foreground md:hidden">
                      {formatCompact(entry.generations)} responses
                    </span>
                  </span>
                </span>
                <Value value={entry.totalTokens} />
                <span className="hidden text-right text-sm text-muted-foreground md:block">
                  {formatCompact(entry.generations)}
                </span>
                <span className="hidden text-right text-sm text-muted-foreground md:block">
                  {formatCompact(entry.inputTokens)}
                </span>
                <span className="hidden text-right text-sm text-muted-foreground md:block">
                  {formatCompact(entry.outputTokens)}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 px-3 py-4 sm:px-5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-xl"
        title={formatExact(value)}
      >
        {formatCompact(value)}
      </dd>
    </div>
  );
}

function Rank({ value, active }: { value: number; active: boolean }) {
  if (value === 1 && active) {
    return (
      <span
        className="flex size-7 items-center justify-center text-amber-600 dark:text-amber-400"
        aria-label="Rank 1"
      >
        <Trophy className="size-4" />
      </span>
    );
  }
  return (
    <span className="pl-2 text-sm tabular-nums text-muted-foreground">
      {value}
    </span>
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
          className="flex h-16 items-center gap-3 border-b px-3 last:border-b-0"
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
