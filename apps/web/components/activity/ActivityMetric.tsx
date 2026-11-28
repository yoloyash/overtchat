"use client";

import { useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import { cn } from "@/lib/utils";
import { formatCompact, formatExact } from "./activity-format";

export function ActivityMetric({
  label,
  value,
  pending = false,
  inline = false,
}: {
  label: string;
  value: number | undefined;
  pending?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  return (
    <div className={cn(
      "min-w-0 px-4 py-5 sm:px-5",
      inline
        ? "flex flex-col-reverse items-center gap-1 border-border/60 text-center odd:border-r nth-[-n+2]:border-b @xl:border-r @xl:nth-[-n+2]:border-b-0 @xl:last:border-r-0"
        : "rounded-lg border border-border/70 bg-card",
    )}>
      <dt className={cn("text-xs text-muted-foreground", !inline && "min-h-8 font-medium sm:min-h-0")}>
        {label}
      </dt>
      <dd
        className={cn("tracking-tight tabular-nums", inline ? "text-xl font-medium" : "mt-2 text-2xl font-semibold")}
        title={value === undefined ? undefined : formatExact(value, locale)}
      >
        {pending ? (
          <span
            aria-label={t("activity.metrics.loading")}
            className="block h-8 w-16 rounded motion-skeleton"
          />
        ) : value === undefined ? (
          "—"
        ) : (
          formatCompact(value, locale)
        )}
      </dd>
    </div>
  );
}
