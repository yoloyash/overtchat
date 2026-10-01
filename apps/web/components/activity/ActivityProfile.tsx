"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useActivityProfile } from "@/lib/queries/activity";
import { PROVIDERS } from "@/lib/providers/catalog";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { ActivityMetric } from "./ActivityMetric";
import { formatCompact, formatDate } from "./activity-format";

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
    <div className="@container mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-10">
      <Link
        href="/activity"
        className="inline-flex items-center gap-2 rounded-sm text-xs font-medium text-muted-foreground motion-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" />
        Leaderboard
      </Link>

      <section className="mt-4 flex flex-col items-center gap-4 text-center">
        <ProfileAvatar
          id={data.member.id}
          name={data.member.name}
          image={data.member.image}
          size="lg"
          tone="muted"
        />
        <div className="min-w-0 max-w-full">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {data.member.name}
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Member since {formatDate(data.member.createdAt)}
          </p>
        </div>
      </section>

      <dl className="mt-8 grid grid-cols-2 overflow-hidden rounded-xl border border-border/60 @xl:grid-cols-4">
        <ActivityMetric
          label="Chat tokens"
          inline
          value={data.totals.totalTokens}
        />
        <ActivityMetric
          label="Responses"
          inline
          value={data.totals.generations}
        />
        <ActivityMetric inline label="Input" value={data.totals.inputTokens} />
        <ActivityMetric inline label="Output" value={data.totals.outputTokens} />
      </dl>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Token activity</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.trackingStartedAt
                ? `Tracked since ${formatDate(data.trackingStartedAt)}`
                : "No tracked responses yet"}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Past 365 days</span>
        </div>
        <ActivityHeatmap
          key={`${userId}:${data.throughDate}`}
          daily={data.daily}
          throughDate={data.throughDate}
          name={data.member.name}
        />
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Models</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Share of all responses by model
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {data.models.length} used
          </span>
        </div>
        <div className="mt-4 divide-y divide-border/50">
          {data.models.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No model activity yet.
            </p>
          ) : (
            data.models.map((model) => {
              const share =
                data.totals.generations > 0
                  ? (model.generations / data.totals.generations) * 100
                  : 0;
              return (
                <div
                  key={`${model.providerId}:${model.model}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 py-4 sm:gap-8"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                      <span
                        className="truncate text-sm font-medium"
                        title={model.model}
                      >
                        {model.model}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {providerLabel(model.providerId)}
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-primary/55"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatCompact(model.generations)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
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

function providerLabel(providerId: string): string {
  return Object.values(PROVIDERS).find((provider) => provider.id === providerId)
    ?.label ?? providerId.replaceAll("-", " ");
}

function ProfileSkeleton() {
  return (
    <div className="@container mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-8">
      <div className="h-4 w-24 rounded motion-skeleton" />
      <div className="flex flex-col items-center gap-4">
        <div className="size-20 rounded-full motion-skeleton" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded motion-skeleton" />
          <div className="h-3 w-32 rounded motion-skeleton" />
        </div>
      </div>
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/60 @xl:grid-cols-4">
        {["Chat tokens", "Responses", "Input", "Output"].map((label) => (
          <ActivityMetric key={label} inline label={label} value={undefined} pending />
        ))}
      </dl>
      <div className="h-48 rounded-lg motion-skeleton" />
      <div className="h-48 rounded-lg motion-skeleton" />
    </div>
  );
}
