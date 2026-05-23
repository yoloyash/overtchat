"use client";

import { Loader2 } from "lucide-react";
import { useModelHealth } from "@/lib/queries/modelConfigs";

export interface HealthBadgeProps {
  id: string;
  enabled: boolean;
}

export function HealthBadge({ id, enabled }: HealthBadgeProps) {
  const { data, isFetching, refetch } = useModelHealth(id);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFetching) refetch();
  }

  let dotClass = "bg-muted-foreground/30";
  let label = "Check";
  let title = "Click to check connection";
  if (isFetching) {
    dotClass = "bg-muted-foreground/30";
    label = "Checking…";
    title = "Checking connection…";
  } else if (data?.ok === true) {
    dotClass = "bg-emerald-500";
    label = `${data.elapsedMs}ms`;
    title = `Working — responded in ${data.elapsedMs}ms`;
  } else if (data?.ok === false) {
    dotClass = "bg-destructive";
    label = "Down";
    title = data.error;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled || isFetching}
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-card/60 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {isFetching ? (
        <Loader2 className="size-2.5 animate-spin" />
      ) : (
        <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}
