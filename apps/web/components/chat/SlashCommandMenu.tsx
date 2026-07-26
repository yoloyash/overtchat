"use client";

import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import {
  groupSlashCommands,
  isSlashCommandAvailable,
  type SlashCommand,
} from "@/lib/chat/slash-commands";
import type { PublicModelConfig } from "@/lib/model-config/schema";

// Rows are flat so the active index is a single number shared by keyboard
// navigation, `aria-activedescendant`, and scroll-into-view.
export type SlashCommandRow =
  | { kind: "command"; command: SlashCommand }
  | { kind: "model"; model: PublicModelConfig };

export function toSlashCommandRows(
  commands: readonly SlashCommand[],
): SlashCommandRow[] {
  return commands.map((command) => ({ kind: "command", command }));
}

export function toSlashCommandModelRows(
  models: readonly PublicModelConfig[],
): SlashCommandRow[] {
  return models.map((model) => ({ kind: "model", model }));
}

interface Props {
  id: string;
  /** Owned by the composer, which points `aria-activedescendant` at a row. */
  optionIdPrefix: string;
  /** Already filtered. Ignored while `models` is set. */
  commands: readonly SlashCommand[];
  /** Non-null while the `/model` submenu is open. */
  models: readonly PublicModelConfig[] | null;
  selectedModelId: string;
  activeIndex: number;
  /** Typed command name, for the empty state. */
  query: string;
  onActiveIndexChange: (index: number) => void;
  onSelect: (row: SlashCommandRow) => void;
}

export function SlashCommandMenu({
  id,
  optionIdPrefix,
  commands,
  models,
  selectedModelId,
  activeIndex,
  query,
  onActiveIndexChange,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => (models ? [] : groupSlashCommands(commands)),
    [commands, models],
  );

  // Indexed in render order so `data-index` matches the composer's cursor.
  const rowIndexes = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    if (models) {
      for (const model of models) map.set(`model:${model.id}`, index++);
    } else {
      for (const group of groups) {
        for (const command of group.commands) {
          map.set(`command:${command.name}`, index++);
        }
      }
    }
    return map;
  }, [groups, models]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const isEmpty = models ? models.length === 0 : commands.length === 0;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-50 mb-2 w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-sm text-popover-foreground shadow-md",
        motionClasses.palette,
      )}
    >
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={models ? "Select model" : "Commands"}
        className="max-h-72 overflow-y-auto p-1.5"
      >
        {isEmpty && (
          <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {models
              ? "No models match this search."
              : `No commands match ${query ? `“/${query}”` : "your search"}.`}
          </p>
        )}

        {models?.map((model) => {
          const index = rowIndexes.get(`model:${model.id}`) ?? 0;
          return (
            <Row
              key={model.id}
              id={`${optionIdPrefix}-${index}`}
              index={index}
              active={index === activeIndex}
              disabled={false}
              icon={
                <ModelBrandIcon
                  iconId={model.modelIconId ?? model.providerIconId}
                  className="size-4"
                />
              }
              title={model.label}
              description={model.displayProvider}
              trailing={
                model.id === selectedModelId ? (
                  <Check className="size-3.5 text-muted-foreground" />
                ) : null
              }
              onActivate={() => onSelect({ kind: "model", model })}
              onHover={() => onActiveIndexChange(index)}
            />
          );
        })}

        {groups.map((group) => (
          <div key={group.group} className="not-first:mt-1">
            <div
              aria-hidden
              className="px-2.5 pt-1.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {group.label}
            </div>
            {group.commands.map((command) => {
              const index = rowIndexes.get(`command:${command.name}`) ?? 0;
              const available = isSlashCommandAvailable(command);
              const Icon = command.icon;
              return (
                <Row
                  key={command.name}
                  id={`${optionIdPrefix}-${index}`}
                  index={index}
                  active={index === activeIndex}
                  disabled={!available}
                  icon={<Icon className="size-4" />}
                  title={command.title}
                  hint={`/${command.name}`}
                  description={
                    command.toggle?.unavailableReason ?? command.description
                  }
                  trailing={
                    command.toggle?.active ? (
                      <Check className="size-3.5 text-muted-foreground" />
                    ) : command.shortcut ? (
                      <Shortcut keys={command.shortcut} />
                    ) : null
                  }
                  selected={command.toggle?.active}
                  onActivate={() => onSelect({ kind: "command", command })}
                  onHover={() => onActiveIndexChange(index)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  id,
  index,
  active,
  disabled,
  selected,
  icon,
  title,
  hint,
  description,
  trailing,
  onActivate,
  onHover,
}: {
  id: string;
  index: number;
  active: boolean;
  disabled: boolean;
  selected?: boolean;
  icon: React.ReactNode;
  title: string;
  hint?: string;
  description?: string;
  trailing?: React.ReactNode;
  onActivate: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected ?? active}
      aria-disabled={disabled || undefined}
      data-index={index}
      data-active={active || undefined}
      // The textarea keeps DOM focus, so pointer interaction must not steal it.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!disabled) onActivate();
      }}
      onPointerMove={onHover}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 motion-colors",
        active && "bg-accent text-accent-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">{title}</span>
          {hint && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {hint}
            </span>
          )}
        </span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {trailing && (
        <span className="flex shrink-0 items-center justify-center">
          {trailing}
        </span>
      )}
    </div>
  );
}

function Shortcut({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex items-center gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded border bg-muted px-1 py-0.5 font-sans text-[10px] leading-none text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
