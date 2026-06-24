"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { cn } from "@/lib/utils";
import type { PublicModelConfig } from "@/lib/config";
import { PRESETS, PRESET_IDS } from "@/lib/providers/meta";

interface Props {
  models: PublicModelConfig[] | null;
  selectedId: string;
  onSelect: (id: string) => void;
}

const GROUP_ORDER = PRESET_IDS.map((id) => PRESETS[id].label);

export function ModelPicker({ models, selectedId, onSelect }: Props) {
  const loading = models === null;
  const selected = models?.find((m) => m.id === selectedId) ?? null;

  const label = loading
    ? "Loading…"
    : selected
      ? selected.label
      : models && models.length > 0
        ? "Select a model"
        : "No models";

  const groups = groupModels(models ?? []);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "min-w-0 max-w-[60%] gap-1.5",
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
          <Menu.Popup className="z-50 max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
            {groups.map(([groupLabel, items]) => (
              <Menu.Group
                key={groupLabel}
                className="py-1 first:pt-0 last:pb-0 not-first:border-t not-first:mt-1 not-first:pt-2"
              >
                <Menu.GroupLabel className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {groupLabel}
                </Menu.GroupLabel>
                {items.map((m) => (
                  <Menu.Item
                    key={m.id}
                    onClick={() => onSelect(m.id)}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <Check
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        m.id === selectedId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <ModelBrandIcon
                      iconId={m.modelIconId ?? m.providerIconId}
                      className="mt-px"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{m.label}</span>
                      {m.label !== m.model && (
                        <span className="truncate text-xs text-muted-foreground">
                          {m.model}
                        </span>
                      )}
                    </span>
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function groupModels(
  models: PublicModelConfig[],
): Array<[string, PublicModelConfig[]]> {
  const buckets = new Map<string, PublicModelConfig[]>();
  for (const m of models) {
    const arr = buckets.get(m.displayProvider) ?? [];
    arr.push(m);
    buckets.set(m.displayProvider, arr);
  }
  return [...buckets.entries()]
    .map(([label, items]) => [label, items] satisfies [string, PublicModelConfig[]])
    .sort(([a], [b]) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
}
