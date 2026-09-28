"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import type {
  ChatReasoningLevel,
  ModelReasoningControls,
  ModelReasoningLevel,
} from "@overtchat/shared";
import { favoriteModelsFirst } from "@overtchat/shared";
import { Brain, Check, ChevronDown, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelSearch } from "@/components/ModelSearch";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { cn } from "@/lib/utils";
import type { PublicModelConfig } from "@/lib/model-config/schema";
import { motionClasses } from "@/lib/motion";
import {
  useModelPreferences,
  useSetModelFavorite,
} from "@/lib/queries/modelPreferences";
import { toast } from "@/components/ui/toast";

interface Props {
  models: PublicModelConfig[] | null;
  selectedId: string;
  onSelect: (id: string) => void;
  reasoningControls?: ModelReasoningControls;
  reasoningLevel: ChatReasoningLevel;
  onSelectReasoningLevel: (level: ChatReasoningLevel) => void;
}

function reasoningOptions(controls: ModelReasoningControls | undefined) {
  if (!controls) return [];

  const options: ModelReasoningLevel[] = [];
  if (controls.efforts?.length) {
    if (controls.toggle) options.push("off");
    if (controls.defaultLevel === "on") options.push("on");
    options.push(...controls.efforts);
  } else if (controls.toggle) {
    options.push("on", "off");
  }
  return [...new Set(options)];
}

export function ModelPicker({
  models,
  selectedId,
  onSelect,
  reasoningControls,
  reasoningLevel,
  onSelectReasoningLevel,
}: Props) {
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const preferences = useModelPreferences();
  const setFavorite = useSetModelFavorite();
  const favoriteModelIds = preferences.data?.favoriteModelIds;
  const loading = models === null;
  const selected = models?.find((m) => m.id === selectedId) ?? null;
  const effectiveReasoningLevel = reasoningControls
    ? reasoningLevel === "default"
      ? reasoningControls.defaultLevel
      : reasoningLevel
    : null;
  const thinkingOptions = reasoningOptions(reasoningControls);

  const label = loading
    ? "Loading…"
    : selected
      ? selected.label
      : models && models.length > 0
        ? "Select model"
        : "No models configured";

  const filteredModels = useMemo(() => {
    const list = favoriteModelsFirst(models ?? [], favoriteModelIds);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      [m.label, m.model, m.displayProvider].join(" ").toLowerCase().includes(q),
    );
  }, [models, search, favoriteModelIds]);

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (!open) {
          setSearch("");
          setSearchExpanded(false);
        }
      }}
    >
      <Menu.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 min-w-0 max-w-[28rem] shrink gap-1.5 overflow-hidden rounded-full px-2.5 text-muted-foreground hover:text-foreground max-md:px-1.5",
              !selected && "text-muted-foreground",
            )}
            disabled={loading || !models || models.length === 0}
            aria-label={`${label}${effectiveReasoningLevel ? `, thinking ${effectiveReasoningLevel}` : ""}`}
          />
        }
      >
        <ModelBrandIcon
          iconId={selected?.modelIconId ?? selected?.providerIconId}
          className="size-4"
        />
        <span className="min-w-0 truncate text-foreground">{label}</span>
        {effectiveReasoningLevel && (
          <>
            <span aria-hidden="true" className="text-border">
              ·
            </span>
            <span className="shrink-0 capitalize">
              {effectiveReasoningLevel}
            </span>
          </>
        )}
        <ChevronDown className="size-3.5 shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8}>
          <Menu.Popup
            className={cn(
              "z-50 max-h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
              "p-1.5",
            )}
          >
            {thinkingOptions.length > 0 && (
              <div className="mb-1 border-b px-1 pb-1.5">
                <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                  <Brain className="size-3.5" />
                  Thinking
                </div>
                <div className="flex flex-wrap gap-1 px-1">
                  {thinkingOptions.map((option) => (
                    <Menu.Item
                      key={option}
                      onClick={() => onSelectReasoningLevel(option)}
                      className={cn(
                        "cursor-pointer rounded-md px-2.5 py-1.5 text-xs capitalize outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                        option === effectiveReasoningLevel &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      {option}
                      {option === reasoningControls?.defaultLevel
                        ? " (default)"
                        : ""}
                    </Menu.Item>
                  ))}
                </div>
              </div>
            )}
            <ModelSearch
              count={models?.length ?? 0}
              search={search}
              onSearch={setSearch}
              expanded={searchExpanded}
              onExpanded={setSearchExpanded}
            />

            <div>
              {filteredModels.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No models match{" "}
                  <span className="text-foreground">{search.trim()}</span>.
                </div>
              ) : (
                filteredModels.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "group/model flex items-center rounded-md hover:bg-accent focus-within:bg-accent",
                      m.id === selectedId && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Menu.Item
                      onClick={() => onSelect(m.id)}
                      className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      <ModelBrandIcon
                        iconId={m.modelIconId ?? m.providerIconId}
                      />
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {m.id === selectedId && (
                          <Check className="size-3.5 text-muted-foreground" />
                        )}
                      </span>
                    </Menu.Item>
                    <Menu.Item
                      closeOnClick={false}
                      disabled={preferences.isPending || setFavorite.isPending}
                      aria-label={
                        favoriteModelIds?.includes(m.id)
                          ? `Remove ${m.label} from favorites`
                          : `Add ${m.label} to favorites`
                      }
                      title={
                        favoriteModelIds?.includes(m.id)
                          ? "Remove from favorites"
                          : "Add to favorites"
                      }
                      onClick={() =>
                        setFavorite.mutate(
                          {
                            modelConfigId: m.id,
                            favorite: !favoriteModelIds?.includes(m.id),
                          },
                          {
                            onError: (error) =>
                              toast.error({ title: error.message }),
                          },
                        )
                      }
                      className={cn(
                        "mr-0.5 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground data-[highlighted]:bg-accent data-[highlighted]:text-foreground data-[disabled]:cursor-wait",
                        !favoriteModelIds?.includes(m.id) &&
                          "[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/model:opacity-100 group-focus-within/model:opacity-100 data-[highlighted]:opacity-100",
                      )}
                    >
                      {setFavorite.isPending &&
                      setFavorite.variables?.modelConfigId === m.id ? (
                        <Loader2
                          className={cn("size-3.5", motionClasses.spinner)}
                        />
                      ) : (
                        <Star
                          className={cn(
                            "size-3.5",
                            favoriteModelIds?.includes(m.id) &&
                              "fill-current text-foreground",
                          )}
                        />
                      )}
                    </Menu.Item>
                  </div>
                ))
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
