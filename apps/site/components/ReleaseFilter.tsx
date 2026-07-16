"use client";

import type { ReactNode } from "react";
import { useState } from "react";

type ReleaseFilterValue = "all" | "web" | "mobile";

const filters: Array<{ value: ReleaseFilterValue; label: string }> = [
  { value: "all", label: "All releases" },
  { value: "web", label: "Web" },
  { value: "mobile", label: "Mobile" },
];

export function ReleaseFilter({
  children,
  counts,
}: {
  children: ReactNode;
  counts: Record<ReleaseFilterValue, number>;
}) {
  const [filter, setFilter] = useState<ReleaseFilterValue>("all");

  return (
    <div className="release-collection" data-filter={filter}>
      <div className="release-filter" role="group" aria-label="Filter releases">
        {filters.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
            <span>{counts[option.value]}</span>
          </button>
        ))}
      </div>
      <div className="release-list">{children}</div>
    </div>
  );
}
