"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronDown,
  Coins,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { SidebarToggle } from "@/components/SidebarToggle";
import { UsageIndicator } from "@/components/chat/UsageIndicator";
import type {
  AgentModel,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import { modelIconForModel } from "@/lib/providers/catalog";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function AgentSessionHeader({
  providerLabel,
  workspaceName,
  models,
  currentModel,
  thinkingLevel,
  thinkingLevels,
  stats,
  running,
  commandPending,
  readOnly,
  onSelectModel,
  onSelectThinking,
  onRename,
  onCompact,
}: {
  providerLabel: string;
  workspaceName: string;
  models: AgentModel[];
  currentModel: { provider: string; id: string } | null;
  thinkingLevel: AgentThinkingLevel | null;
  thinkingLevels: AgentThinkingLevel[];
  stats: AgentSessionStats;
  running: boolean;
  commandPending: boolean;
  readOnly: boolean;
  onSelectModel: (model: AgentModel) => void;
  onSelectThinking: (level: AgentThinkingLevel) => void;
  onRename: () => void;
  onCompact: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <SidebarToggle />
      <span
        className="hidden max-w-40 truncate px-1 text-sm font-medium lg:block"
        title={workspaceName}
      >
        {workspaceName}
      </span>
      <AgentModelPicker
        providerLabel={providerLabel}
        models={models}
        currentModel={currentModel}
        disabled={readOnly || running || commandPending}
        onSelect={onSelectModel}
      />
      {thinkingLevels.length > 0 && thinkingLevel && (
        <Select
          value={thinkingLevel}
          onValueChange={(value) =>
            onSelectThinking(value as AgentThinkingLevel)
          }
          disabled={readOnly || running || commandPending}
        >
          <SelectTrigger
            size="sm"
            aria-label="Thinking level"
            title="Thinking level"
            className="max-w-28 border-0"
          >
            <Sparkles className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {thinkingLevels.map((level) => (
              <SelectItem key={level} value={level}>
                {thinkingLabel(level)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {stats.contextUsage && stats.contextUsage.tokens !== null && (
          <UsageIndicator
            contextUsage={{
              usedTokens: stats.contextUsage.tokens,
              contextWindow: stats.contextUsage.contextWindow,
            }}
          />
        )}
        <SessionStats stats={stats} />
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Session actions"
                title="Session actions"
                disabled={readOnly}
              />
            }
          >
            <MoreHorizontal />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6}>
              <Menu.Popup
                className={cn(
                  "z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                  motionClasses.popup,
                )}
              >
                <Menu.Item
                  disabled={readOnly}
                  onClick={onRename}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  <Pencil className="size-3.5 text-muted-foreground" />
                  Rename session
                </Menu.Item>
                <Menu.Item
                  disabled={readOnly || running || commandPending}
                  onClick={onCompact}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                >
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  Compact context
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  );
}

function AgentModelPicker({
  providerLabel,
  models,
  currentModel,
  disabled,
  onSelect,
}: {
  providerLabel: string;
  models: AgentModel[];
  currentModel: { provider: string; id: string } | null;
  disabled: boolean;
  onSelect: (model: AgentModel) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = models.find(
    (model) =>
      model.provider === currentModel?.provider && model.id === currentModel.id,
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) =>
      [model.name, model.id, model.provider]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [models, search]);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-[45vw] sm:max-w-72"
            disabled={disabled || models.length === 0}
          />
        }
      >
        <ModelBrandIcon
          iconId={iconForModel(selected)}
          className="size-4"
        />
        <span className="truncate">
          {selected?.name ?? currentModel?.id ?? "Select model"}
        </span>
        <ChevronDown className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6}>
          <Menu.Popup
            className={cn(
              "z-50 max-h-96 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-popover text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <div className="sticky top-0 z-10 border-b bg-popover p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={`Search ${providerLabel} models`}
                  aria-label={`Search ${providerLabel} models`}
                  className="h-7 pl-7 text-xs md:text-xs"
                />
              </div>
            </div>
            <div className="p-1">
              {filtered.map((model) => {
                const active =
                  model.provider === currentModel?.provider &&
                  model.id === currentModel.id;
                return (
                  <Menu.Item
                    key={`${model.provider}/${model.id}`}
                    onClick={() => {
                      onSelect(model);
                      setSearch("");
                    }}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none motion-colors data-[highlighted]:bg-accent",
                      active && "bg-accent",
                    )}
                  >
                    <ModelBrandIcon
                      iconId={iconForModel(model)}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{model.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {model.provider} / {model.id}
                      </span>
                    </span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {active && <Check className="size-3.5" />}
                    </span>
                  </Menu.Item>
                );
              })}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SessionStats({ stats }: { stats: AgentSessionStats }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Session usage"
            title="Session usage"
          />
        }
      >
        <Coins />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup
            className={cn(
              "z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Popover.Title className="font-medium">Session usage</Popover.Title>
            <div className="mt-3 space-y-2">
              <StatsRow label="Input" value={formatInteger(stats.tokens.input)} />
              <StatsRow label="Output" value={formatInteger(stats.tokens.output)} />
              <StatsRow
                label="Cache read"
                value={formatInteger(stats.tokens.cacheRead)}
              />
              <StatsRow label="Total" value={formatInteger(stats.tokens.total)} />
              <StatsRow label="Estimated cost" value={formatCost(stats.cost)} />
              <StatsRow
                label="Tool calls"
                value={formatInteger(stats.toolCalls)}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function iconForModel(model: AgentModel | undefined) {
  if (!model) return null;
  return (
    modelIconForModel(`${model.provider}/${model.id}`) ??
    modelIconForModel(model.id) ??
    modelIconForModel(model.provider)
  );
}

function thinkingLabel(level: AgentThinkingLevel): string {
  return level === "off"
    ? "Off"
    : level === "xhigh"
      ? "Extra high"
      : level[0].toUpperCase() + level.slice(1);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}
