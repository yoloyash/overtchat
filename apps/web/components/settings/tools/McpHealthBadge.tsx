"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motionClasses } from "@/lib/motion";
import { useMcpServerHealth } from "@/lib/queries/mcpServers";

export function McpHealthBadge({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isFetching, refetch } = useMcpServerHealth(id);

  let dotClass = "bg-muted-foreground/30";
  let label = t("tools.mcp.health.check");
  let title = t("tools.mcp.health.checkTitle");
  if (isFetching) {
    label = t("tools.mcp.health.checking");
    title = t("tools.mcp.health.checkingTitle");
  } else if (data?.ok === true) {
    dotClass = "bg-emerald-500";
    label = t("tools.mcp.health.toolCount", { count: data.toolCount });
    title = t("tools.mcp.health.workingTitle", {
      count: data.toolCount,
      elapsedMs: data.elapsedMs,
    });
  } else if (data?.ok === false) {
    dotClass = "bg-destructive";
    label = t("tools.mcp.health.down");
    title = data.error;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!isFetching) void refetch();
      }}
      disabled={isFetching}
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-card/60 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground motion-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {isFetching ? (
        <Loader2 className={`size-2.5 ${motionClasses.spinner}`} />
      ) : (
        <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}
