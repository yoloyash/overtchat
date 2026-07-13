"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { cn } from "@/lib/utils";
import type { PublicModelConfig } from "@/lib/config";

interface Props {
  models: PublicModelConfig[] | null;
  selectedId: string;
  onSelect: (id: string) => void;
}

const SEARCH_THRESHOLD = 7;

export function ModelPicker({ models, selectedId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const loading = models === null;
  const selected = models?.find((m) => m.id === selectedId) ?? null;
  const showSearch = (models?.length ?? 0) > SEARCH_THRESHOLD;

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
      [m.label, m.model, m.displayProvider]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [models, search]);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "min-w-0 max-w-[60%] gap-1.5 sm:max-w-96",
              !selected && "text-muted-foreground",
            )}
            disabled={loading || !models || models.length === 0}
          />
        }
      >
        <ModelBrandIcon
          iconId={selected?.modelIconId ?? selected?.providerIconId}
          className="size-4"
        />
        <span className="truncate">{label}</span>
        <ChevronDown className="shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6}>
          <Menu.Popup
            className={cn(
              "z-50 max-h-96 w-80 overflow-y-auto rounded-lg border bg-popover text-sm text-popover-foreground shadow-md outline-none",
              showSearch ? "p-0" : "p-1",
            )}
          >
            {showSearch && (
              <div className="sticky top-0 z-10 border-b bg-popover p-2">
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

            <div className={showSearch ? "p-1" : undefined}>
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
                      "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                      m.id === selectedId && "bg-accent text-accent-foreground",
                    )}
                  >
                    <ModelBrandIcon iconId={m.modelIconId ?? m.providerIconId} />
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
