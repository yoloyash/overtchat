"use client";

import { useState } from "react";
import { Brain, Pencil, Plus, Search } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type {
  Memory,
  PersonalizationSnapshot,
} from "@/lib/personalization/schema";
import { useClearMemories } from "@/lib/queries/personalization";
import { SettingsSection } from "../SettingsRows";
import {
  ClearMemoriesButton,
  DeleteMemoryButton,
  MemoryDialog,
} from "./MemoryDialogs";

export function MemoryManager({
  memories,
  usage,
}: {
  memories: Memory[];
  usage: PersonalizationSnapshot["contextUsage"];
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const clearMemories = useClearMemories();
  const [memoryDialog, setMemoryDialog] = useState<
    Memory | null | undefined
  >();
  const [memoryQuery, setMemoryQuery] = useState("");
  const normalizedQuery = memoryQuery.trim().toLocaleLowerCase();
  const filteredMemories = normalizedQuery
    ? memories.filter(
        (memory) =>
          memory.key.toLocaleLowerCase().includes(normalizedQuery) ||
          memory.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : memories;
  const usagePercent = Math.min(
    100,
    Math.round(
      Math.max(usage.bytes / usage.limit, usage.entries / usage.entryLimit) *
        100,
    ),
  );
  const usageTitle = t("personalization.memories.usageTooltip", {
    bytes: usage.bytes.toLocaleString(locale),
    limit: usage.limit.toLocaleString(locale),
    entries: usage.entries,
    entryLimit: usage.entryLimit,
  });

  return (
    <>
      <SettingsSection
        title={t("personalization.memories.title")}
        description={t("personalization.memories.description")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={usageTitle}
              className="rounded-full border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            >
              {t("personalization.memories.usageBadge", {
                percent: usagePercent,
              })}
            </span>
            {memories.length > 0 && (
              <ClearMemoriesButton
                pending={clearMemories.isPending}
                onClear={async () => {
                  await clearMemories.mutateAsync(undefined);
                  toast.success({
                    title: t("personalization.memories.clearedToast"),
                  });
                }}
              />
            )}
            <Button type="button" size="sm" onClick={() => setMemoryDialog(null)}>
              <Plus /> {t("personalization.memories.add")}
            </Button>
          </div>
        }
        contentClassName="divide-y-0 border-y-0"
      >
        <div className="space-y-4 pt-1">
          {(memories.length >= 5 || memoryQuery) && (
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={memoryQuery}
                onChange={(event) => setMemoryQuery(event.target.value)}
                placeholder={t("personalization.memories.searchPlaceholder")}
                aria-label={t("personalization.memories.searchLabel")}
                className="pl-8"
              />
            </div>
          )}
          {memories.length === 0 ? (
            <div className="border-y border-dashed px-6 py-12 text-center">
              <Brain className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {t("personalization.memories.emptyTitle")}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("personalization.memories.emptyDescription")}
              </p>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="border-y px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="personalization.memories.noMatches"
                  values={{ query: memoryQuery.trim() }}
                  components={{
                    query: <span className="text-foreground" />,
                  }}
                />
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/70 border-y">
              {filteredMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  onEdit={() => setMemoryDialog(memory)}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      {memoryDialog !== undefined && (
        <MemoryDialog
          key={memoryDialog?.id ?? "new-memory"}
          memory={memoryDialog}
          onOpenChange={(open) => {
            if (!open) setMemoryDialog(undefined);
          }}
        />
      )}
    </>
  );
}

function MemoryCard({ memory, onEdit }: { memory: Memory; onEdit: () => void }) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  return (
    <article className="group/memory flex items-start gap-3 py-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Brain className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">
          {memory.value}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <code>{memory.key}</code>
          <span aria-hidden="true">·</span>
          <time dateTime={memory.updatedAt}>
            {t("personalization.memories.updated", {
              date: new Date(memory.updatedAt).toLocaleDateString(locale),
            })}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label={t("personalization.memories.editAriaLabel", {
            key: memory.key,
          })}
          title={t("personalization.memories.editTitle")}
        >
          <Pencil />
        </Button>
        <DeleteMemoryButton memory={memory} />
      </div>
    </article>
  );
}
