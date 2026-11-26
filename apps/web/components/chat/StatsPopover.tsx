"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import {
  formatDuration,
  formatInteger,
  formatTps,
  type MessageStats,
} from "@/lib/chat/stats";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface StatsRow {
  id: string;
  iconId?: MessageStats["providerIconId"];
  label: string;
  value: string;
}

export function StatsPopover({ stats }: { stats: MessageStats }) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const candidateRows: Array<StatsRow | null> = [
    stats.providerLabel !== undefined
      ? {
          id: "provider",
          iconId: stats.providerIconId,
          label: t("chat.stats.provider"),
          value: stats.providerLabel,
        }
      : null,
    stats.model !== undefined
      ? {
          id: "model",
          iconId: stats.modelIconId ?? stats.providerIconId,
          label: t("chat.stats.model"),
          value: stats.model,
        }
      : null,
    stats.contextTokens !== undefined
      ? {
          id: "contextTokens",
          label: t("chat.stats.contextTokens"),
          value: formatInteger(stats.contextTokens, locale),
        }
      : null,
    stats.uncachedInputTokens !== undefined
      ? {
          id: "uncachedInput",
          label: t("chat.stats.uncachedInput"),
          value: formatInteger(stats.uncachedInputTokens, locale),
        }
      : null,
    stats.cacheReadTokens !== undefined
      ? {
          id: "cacheRead",
          label: t("chat.usage.cacheRead"),
          value: formatInteger(stats.cacheReadTokens, locale),
        }
      : null,
    stats.cacheWriteTokens !== undefined
      ? {
          id: "cacheWrite",
          label: t("chat.usage.cacheWrite"),
          value: formatInteger(stats.cacheWriteTokens, locale),
        }
      : null,
    stats.responseTokens !== undefined
      ? {
          id: "responseTokens",
          label: t("chat.stats.responseTokens"),
          value: formatInteger(stats.responseTokens, locale),
        }
      : null,
    stats.totalTokens !== undefined
      ? {
          id: "totalTokens",
          label: t("chat.stats.totalTokens"),
          value: formatInteger(stats.totalTokens, locale),
        }
      : null,
    stats.ttftMs !== undefined
      ? { id: "ttft", label: t("chat.stats.ttft"), value: formatDuration(stats.ttftMs, t) }
      : null,
    stats.tps !== undefined
      ? { id: "tps", label: t("chat.stats.tps"), value: formatTps(stats.tps, t) }
      : null,
    stats.finishReason !== undefined
      ? {
          id: "finishReason",
          label: t("chat.stats.finishReason"),
          value: stats.finishReason,
        }
      : null,
  ];
  const rows = candidateRows.filter((row): row is StatsRow => row !== null);

  if (!rows.length) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={t("chat.stats.title")}
        title={t("chat.stats.title")}
        className="rounded-md p-1.5 text-muted-foreground motion-colors hover:bg-accent hover:text-foreground max-md:p-2.5"
      >
        <Info className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6}>
          <Popover.Popup
            className={cn(
              "z-50 w-56 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <div className="space-y-2">
              {rows.map(({ id, iconId, label, value }) => (
                <div key={id} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-foreground">
                    <ModelBrandIcon iconId={iconId} className="size-3.5" />
                    <span className="truncate">{value}</span>
                  </span>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
