"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, CalendarDays, MessageSquareText } from "lucide-react";
import type { ActivityTotals } from "@/lib/activity/types";
import { useActivityProfile } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";
import { ActivityAvatar } from "./ActivityAvatar";
import { formatCompact, formatDate, formatExact } from "./activity-format";

const EMPTY_TOTALS: ActivityTotals = {
  generations: 0,
  inputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

export function ActivityProfile({ userId }: { userId: string }) {
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const { data, isPending, isError } = useActivityProfile(userId, timeZone);

  if (isPending) return <ProfileSkeleton />;
  if (isError || !data) {
    return (
      <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          This activity profile could not be loaded.
        </p>
        <Link
          href="/activity"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          Return to leaderboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 md:px-8 md:py-10">
      <Link
        href="/activity"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground motion-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Leaderboard
      </Link>

      <section className="mt-6 flex items-center gap-4 md:gap-5">
        <ActivityAvatar
          id={data.member.id}
          name={data.member.name}
          image={data.member.image}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">
            {data.member.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" />
            Member since {formatDate(data.member.createdAt)}
          </p>
        </div>
      </section>

      <dl className="mt-8 grid grid-cols-2 divide-x divide-y border-y md:grid-cols-4 md:divide-y-0">
        <ProfileMetric
          label="Chat tokens"
          value={data.totals.totalTokens}
          icon={MessageSquareText}
        />
        <ProfileMetric
          label="Responses"
          value={data.totals.generations}
          icon={Bot}
        />
        <ProfileMetric label="Input" value={data.totals.inputTokens} />
        <ProfileMetric label="Output" value={data.totals.outputTokens} />
      </dl>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Activity</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.trackingStartedAt
                ? `Tracked since ${formatDate(data.trackingStartedAt)}`
                : "No tracked responses yet"}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Past year</span>
        </div>
        <UsageHeatmap
          daily={data.daily}
          throughDate={data.throughDate}
          name={data.member.name}
        />
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Models</h2>
          <span className="text-xs text-muted-foreground">
            {data.models.length} used
          </span>
        </div>
        <div className="mt-3 border-y">
          {data.models.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No model activity yet.
            </p>
          ) : (
            data.models.map((model) => {
              const maxGenerations = data.models[0]?.generations ?? 1;
              const width = `${Math.max(
                4,
                (model.generations / maxGenerations) * 100,
              )}%`;
              return (
                <div
                  key={`${model.providerId}:${model.model}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-3 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">
                        {model.model}
                      </span>
                      <span className="shrink-0 text-[11px] uppercase text-muted-foreground">
                        {providerLabel(model.providerId)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-teal-500 dark:bg-teal-400"
                        style={{ width }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCompact(model.generations)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      responses
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon?: typeof Bot;
}) {
  return (
    <div className="min-w-0 px-4 py-4">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </dt>
      <dd
        className="mt-1 text-xl font-semibold tabular-nums"
        title={formatExact(value)}
      >
        {formatCompact(value)}
      </dd>
    </div>
  );
}

function UsageHeatmap({
  daily,
  throughDate,
  name,
}: {
  daily: Array<ActivityTotals & { date: string }>;
  throughDate: string;
  name: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const days = dateRange(throughDate, 365);
  const leading = dayOfWeek(days[0]?.date ?? throughDate);
  const maxTokens = Math.max(0, ...daily.map((day) => day.totalTokens));

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [throughDate]);

  return (
    <div className="mt-4">
      <div className="flex min-w-0">
        <div
          aria-hidden="true"
          className="mr-2 grid shrink-0 grid-rows-7 gap-[3px] pt-px text-[9px] leading-[10px] text-muted-foreground"
        >
          <span />
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
        </div>
        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-x-auto pb-2"
        >
          <div
            role="grid"
            aria-label={`${name} activity over the past year`}
            className="grid w-max grid-flow-col grid-rows-7 gap-[3px]"
          >
            {Array.from({ length: leading }).map((_, index) => (
              <span key={`empty-${index}`} className="size-2.5" />
            ))}
            {days.map(({ date, label }) => {
              const usage = byDate.get(date) ?? EMPTY_TOTALS;
              const level = heatLevel(usage.totalTokens, maxTokens);
              const title = `${label}: ${formatExact(
                usage.totalTokens,
              )} chat tokens, ${formatExact(usage.generations)} responses`;
              return (
                <span
                  key={date}
                  role="gridcell"
                  aria-label={title}
                  title={title}
                  className={cn(
                    "size-2.5 rounded-[2px] ring-1 ring-inset ring-black/5 dark:ring-white/5",
                    HEAT_CLASSES[level],
                  )}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        {HEAT_CLASSES.map((className, index) => (
          <span
            key={index}
            className={cn("size-2.5 rounded-[2px]", className)}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

const HEAT_CLASSES = [
  "bg-muted",
  "bg-teal-200 dark:bg-teal-950",
  "bg-teal-400 dark:bg-teal-800",
  "bg-teal-600 dark:bg-teal-600",
  "bg-teal-800 dark:bg-teal-400",
];

function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(max)) * 4)));
}

function dateRange(
  throughDate: string,
  count: number,
): Array<{ date: string; label: string }> {
  const end = new Date(`${throughDate}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (count - 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
    };
  });
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function providerLabel(providerId: string): string {
  return providerId.replaceAll("-", " ");
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-8">
      <div className="h-4 w-24 rounded motion-skeleton" />
      <div className="flex items-center gap-4">
        <div className="size-20 rounded-full motion-skeleton" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded motion-skeleton" />
          <div className="h-3 w-32 rounded motion-skeleton" />
        </div>
      </div>
      <div className="h-20 border-y motion-skeleton" />
      <div className="h-32 rounded-md motion-skeleton" />
    </div>
  );
}
