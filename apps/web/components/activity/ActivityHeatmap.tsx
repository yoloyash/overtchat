"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import type { ActivityTotals } from "@/lib/activity/types";
import { cn } from "@/lib/utils";
import { formatCompact, formatExact } from "./activity-format";

const HEAT_CLASSES = [
  "bg-muted",
  "bg-primary/20",
  "bg-primary/35",
  "bg-primary/50",
  "bg-primary/70",
];

export function ActivityHeatmap({
  daily,
  throughDate,
  name,
}: {
  daily: Array<ActivityTotals & { date: string }>;
  throughDate: string;
  name: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedDay, setFocusedDay] = useState(364);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const start = new Date(`${throughDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 364);
  const leading = start.getUTCDay();
  const weeks = Math.ceil((leading + 365) / 7);
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
  const days = Array.from({ length: 365 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return { day, date, usage: byDate.get(date) };
  });
  const maxTokens = Math.max(1, ...daily.map((day) => day.totalTokens));

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [throughDate]);

  return (
    <Tooltip.Provider delay={100}>
      <div ref={scrollRef} className="mt-5 overflow-x-auto pb-2">
        <div className="min-w-[636px]">
          <div role="grid" aria-label={`${name} token activity over the past year`} className="grid gap-1">
            {Array.from({ length: 7 }, (_, weekday) => (
              <div key={weekday} role="row" className="grid gap-1" style={columns}>
                {Array.from({ length: weeks }, (_, week) => {
                  const index = week * 7 + weekday - leading;
                  const entry = days[index];
                  if (!entry) return <span key={week} role="gridcell" aria-hidden="true" />;
                  const tokens = entry.usage?.totalTokens ?? 0;
                  const responses = entry.usage?.generations ?? 0;
                  const level = tokens > 0 ? Math.min(4, Math.ceil((tokens / maxTokens) * 4)) : 0;
                  const dateLabel = new Intl.DateTimeFormat(undefined, {
                    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
                  }).format(entry.day);
                  return (
                    <Tooltip.Root
                      key={week}
                      open={activeDay === index}
                      onOpenChange={(open) => setActiveDay((active) => open ? index : active === index ? null : active)}
                    >
                      <Tooltip.Trigger
                        role="gridcell"
                        data-day-index={index}
                        aria-label={`${dateLabel}: ${formatExact(tokens)} chat tokens, ${formatExact(responses)} responses`}
                        tabIndex={focusedDay === index ? 0 : -1}
                        closeOnClick={false}
                        onClick={() => setActiveDay(index)}
                        onFocus={() => setFocusedDay(index)}
                        onKeyDown={(event) => {
                          const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
                          const offset = offsets[event.key];
                          if (offset === undefined) return;
                          event.preventDefault();
                          const next = Math.max(0, Math.min(364, index + offset));
                          scrollRef.current?.querySelector<HTMLElement>(`[data-day-index="${next}"]`)?.focus();
                        }}
                        className={cn(
                          "aspect-square w-full rounded-[3px] motion-colors hover:ring-1 hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                          HEAT_CLASSES[level],
                        )}
                      />
                      <Tooltip.Portal>
                        <Tooltip.Positioner side="top" sideOffset={8} className="z-50">
                          <Tooltip.Popup role="tooltip" className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                            <p className="font-medium">{formatCompact(tokens)} tokens on {dateLabel}</p>
                            <p className="mt-1 text-muted-foreground">{formatExact(responses)} {responses === 1 ? "response" : "responses"}</p>
                          </Tooltip.Popup>
                        </Tooltip.Positioner>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="mt-3 grid gap-1 text-xs text-muted-foreground" style={columns}>
            {days.map(({ day, date }, index) => {
              const week = Math.floor((leading + index) / 7);
              // Leave enough room for each month label at the edges.
              if (index === 0 && day.getUTCDate() > 14) return null;
              if (index !== 0 && day.getUTCDate() !== 1) return null;
              if (week > weeks - 2) return null;
              return (
                <span key={date} className="whitespace-nowrap" style={{ gridColumn: `${week + 1} / span ${Math.min(3, weeks - week)}` }}>
                  {new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(day)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
