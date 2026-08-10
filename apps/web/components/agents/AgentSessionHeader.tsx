"use client";

import { useMemo, useState } from "react";
import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronDown,
  Code2,
  Coins,
  Copy,
  FileDiff,
  GitBranch,
  MoreHorizontal,
  ListTodo,
  Pencil,
  Search,
  Sparkles,
  Zap,
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
  AgentCollaborationMode,
  AgentSessionStats,
  AgentThinkingLevel,
  AgentWorkspaceGitStatus,
} from "@/lib/agents/types";
import { modelIconForModel } from "@/lib/providers/catalog";
import { motionClasses } from "@/lib/motion";
import { useAgentWorkspaceGitStatus } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

export function AgentSessionHeader({
  providerLabel,
  workspaceId,
  workspaceName,
  workspacePath,
  models,
  currentModel,
  thinkingLevel,
  thinkingLevels,
  collaborationMode,
  collaborationModes,
  fastModeEnabled,
  fastModeAvailable,
  stats,
  running,
  commandPending,
  readOnly,
  onSelectModel,
  onSelectThinking,
  onSelectCollaborationMode,
  onToggleFastMode,
  onRename,
  onCompact,
}: {
  providerLabel: string;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  models: AgentModel[];
  currentModel: { provider: string; id: string } | null;
  thinkingLevel: AgentThinkingLevel | null;
  thinkingLevels: AgentThinkingLevel[];
  collaborationMode: AgentCollaborationMode;
  collaborationModes: AgentCollaborationMode[];
  fastModeEnabled: boolean;
  fastModeAvailable: boolean;
  stats: AgentSessionStats;
  running: boolean;
  commandPending: boolean;
  readOnly: boolean;
  onSelectModel: (model: AgentModel) => void;
  onSelectThinking: (level: AgentThinkingLevel) => void;
  onSelectCollaborationMode: (mode: AgentCollaborationMode) => void;
  onToggleFastMode: (enabled: boolean) => void;
  onRename: () => void;
  onCompact: () => void;
}) {
  const gitStatus = useAgentWorkspaceGitStatus(workspaceId, {
    active: true,
    running,
  }).data;
  const branch = gitStatus?.branch;

  async function copyWorkspaceValue(value: string, label: string) {
    try {
      await clipboardWriteText(value);
      toast.success({ title: `${label} copied` });
    } catch {
      toast.error({ title: `Could not copy ${label.toLowerCase()}` });
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <SidebarToggle />
      <span
        className="hidden max-w-40 truncate px-1 text-sm font-medium lg:block"
        title={workspaceName}
      >
        {workspaceName}
      </span>
      <WorkspaceGitSummary status={gitStatus} />
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
      {collaborationModes.length > 1 && (
        <div
          role="group"
          aria-label="Codex mode"
          className="hidden h-8 shrink-0 items-center rounded-md border bg-muted/20 p-0.5 md:flex"
        >
          {collaborationModes.map((mode) => {
            const selected = mode === collaborationMode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={readOnly || running || commandPending}
                onClick={() => onSelectCollaborationMode(mode)}
                className={cn(
                  "flex h-6 items-center gap-1 rounded px-2 text-xs font-medium motion-colors disabled:cursor-not-allowed disabled:opacity-50",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === "plan" ? (
                  <ListTodo className="size-3.5" />
                ) : (
                  <Code2 className="size-3.5" />
                )}
                {mode === "plan" ? "Plan" : "Code"}
              </button>
            );
          })}
        </div>
      )}
      {fastModeAvailable && (
        <Button
          type="button"
          variant={fastModeEnabled ? "secondary" : "ghost"}
          size="sm"
          className="hidden h-8 px-2 md:inline-flex"
          aria-pressed={fastModeEnabled}
          title="Fast mode uses priority inference at higher usage"
          disabled={readOnly || running || commandPending}
          onClick={() => onToggleFastMode(!fastModeEnabled)}
        >
          <Zap className="size-3.5" />
          Fast
        </Button>
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
                  onClick={() =>
                    void copyWorkspaceValue(workspacePath, "Workspace path")
                  }
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                >
                  <Copy className="size-3.5 text-muted-foreground" />
                  Copy workspace path
                </Menu.Item>
                {branch && (
                  <Menu.Item
                    onClick={() =>
                      void copyWorkspaceValue(branch, "Branch name")
                    }
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent"
                  >
                    <GitBranch className="size-3.5 text-muted-foreground" />
                    Copy branch name
                  </Menu.Item>
                )}
                <Menu.Separator className="my-1 h-px bg-border" />
                {collaborationModes.length > 1 &&
                  collaborationModes.map((mode) => (
                    <Menu.Item
                      key={mode}
                      disabled={readOnly || running || commandPending}
                      onClick={() => onSelectCollaborationMode(mode)}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                    >
                      {mode === "plan" ? (
                        <ListTodo className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Code2 className="size-3.5 text-muted-foreground" />
                      )}
                      {mode === "plan" ? "Plan mode" : "Code mode"}
                      {mode === collaborationMode && (
                        <Check className="ml-auto size-3.5" />
                      )}
                    </Menu.Item>
                  ))}
                {fastModeAvailable && (
                  <Menu.Item
                    disabled={readOnly || running || commandPending}
                    onClick={() => onToggleFastMode(!fastModeEnabled)}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                  >
                    <Zap className="size-3.5 text-muted-foreground" />
                    Fast mode
                    {fastModeEnabled && (
                      <Check className="ml-auto size-3.5" />
                    )}
                  </Menu.Item>
                )}
                {(collaborationModes.length > 1 || fastModeAvailable) && (
                  <Menu.Separator className="my-1 h-px bg-border" />
                )}
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

function WorkspaceGitSummary({
  status,
}: {
  status: AgentWorkspaceGitStatus | undefined;
}) {
  if (!status?.isGit) return null;
  const branch = status.branch ?? "Detached HEAD";
  const tracking = [
    status.ahead ? `${status.ahead} ahead` : null,
    status.behind ? `${status.behind} behind` : null,
  ].filter(Boolean);
  const title = [
    branch,
    ...tracking,
    status.dirty
      ? `${status.changedFiles} changed ${status.changedFiles === 1 ? "file" : "files"}`
      : "Clean working tree",
  ].join(" · ");

  return (
    <div
      data-testid="agent-workspace-git-status"
      title={title}
      className="hidden min-w-0 items-center gap-2 px-1 text-[11px] text-muted-foreground lg:flex"
    >
      <span className="flex min-w-0 items-center gap-1">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="max-w-28 truncate">{branch}</span>
      </span>
      {status.dirty && (
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <FileDiff className="size-3.5" />
          <span>
            {status.changedFiles}{" "}
            {status.changedFiles === 1 ? "file" : "files"}
          </span>
          {status.lineStatsComplete && (
            <>
              <span className="text-emerald-700 dark:text-emerald-300">
                +{status.additions}
              </span>
              <span className="text-red-700 dark:text-red-300">
                -{status.deletions}
              </span>
            </>
          )}
        </span>
      )}
    </div>
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
