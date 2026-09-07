"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import type {
  ChatReasoningLevel,
  ModelReasoningControls,
  ModelReasoningLevel,
} from "@overtchat/shared";
import { Brain, Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { cn } from "@/lib/utils";
import type { PublicModelConfig } from "@/lib/model-config/schema";
import { motionClasses } from "@/lib/motion";

interface Props {
  models: PublicModelConfig[] | null;
  selectedId: string;
  onSelect: (id: string) => void;
  reasoningControls?: ModelReasoningControls;
  reasoningLevel: ChatReasoningLevel;
  onSelectReasoningLevel: (level: ChatReasoningLevel) => void;
}

const SEARCH_THRESHOLD = 7;

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
  const loading = models === null;
  const selected = models?.find((m) => m.id === selectedId) ?? null;
  const showSearch = (models?.length ?? 0) > SEARCH_THRESHOLD;
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
    const list = models ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      [m.label, m.model, m.displayProvider].join(" ").toLowerCase().includes(q),
    );
  }, [models, search]);

  return (
    <Menu.Root>
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
            <span className="shrink-0 capitalize">{effectiveReasoningLevel}</span>
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
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Model
            </div>
            {showSearch && (
              <div className="sticky top-0 z-10 bg-popover px-1 pb-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Search models"
                    aria-label="Search models"
                    className="h-7 pl-7 text-xs md:text-xs"
                  />
                </div>
              </div>
            )}

            <div>
              {filteredModels.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No models match{" "}
                  <span className="text-foreground">{search.trim()}</span>.
                </div>
              ) : (
                filteredModels.map((m) => (
                  <Menu.Item
                    key={m.id}
                    onClick={() => {
                      onSelect(m.id);
                      setSearch("");
                    }}
                    className={cn(
                      "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                      m.id === selectedId && "bg-accent text-accent-foreground",
                    )}
                  >
                    <ModelBrandIcon
                      iconId={m.modelIconId ?? m.providerIconId}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {m.id === selectedId ? (
                        <Check className="size-3.5 text-muted-foreground" />
                      ) : null}
                    </span>
                  </Menu.Item>
                ))
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
