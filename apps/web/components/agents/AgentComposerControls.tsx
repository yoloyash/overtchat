"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  X,
  Zap,
} from "lucide-react";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { Button } from "@/components/ui/button";
import type {
  AgentCollaborationMode,
  AgentModel,
  AgentThinkingLevel,
} from "@overtchat/agent-bridge";
import { motionClasses } from "@/lib/motion";
import { modelIconForModel } from "@/lib/providers/catalog";
import { cn } from "@/lib/utils";

export interface AgentComposerControlsProps {
  providerLabel: string;
  models: AgentModel[];
  currentModel: { provider: string; id: string } | null;
  thinkingLevel: AgentThinkingLevel | null;
  thinkingLevels: AgentThinkingLevel[];
  collaborationMode: AgentCollaborationMode;
  collaborationModes: AgentCollaborationMode[];
  fastModeEnabled: boolean;
  fastModeAvailable: boolean;
  disabled: boolean;
  onSelectModel: (model: AgentModel) => void;
  onSelectThinking: (level: AgentThinkingLevel) => void;
  onSelectCollaborationMode: (mode: AgentCollaborationMode) => void;
  onToggleFastMode: (enabled: boolean) => void;
  onMenuOpenChange?: (open: boolean) => void;
}

const controlRowClassName =
  "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground";

const choiceItemClassName =
  "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

export function AgentComposerControls(props: AgentComposerControlsProps) {
  const hasModelOrEffort =
    props.models.length > 0 ||
    (props.thinkingLevels.length > 1 && props.thinkingLevel !== null);
  const hasControls =
    hasModelOrEffort ||
    props.collaborationMode === "plan" ||
    props.fastModeAvailable;

  if (!hasControls) return null;

  return (
    <div
      data-testid="agent-composer-controls"
      className="flex min-w-0 items-center gap-0.5"
    >
      {hasModelOrEffort && <ModelEffortControl {...props} />}
      {props.collaborationMode === "plan" && (
        <PlanModeControl
          disabled={props.disabled}
          onExit={() => props.onSelectCollaborationMode("default")}
          onOpenChange={props.onMenuOpenChange}
        />
      )}
      {props.fastModeAvailable && (
        <Button
          type="button"
          variant={props.fastModeEnabled ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2"
          aria-pressed={props.fastModeEnabled}
          aria-label="Fast"
          title="Fast mode uses priority inference at higher usage"
          disabled={props.disabled}
          onClick={() => props.onToggleFastMode(!props.fastModeEnabled)}
        >
          <Zap className="size-3.5" />
          <span className="hidden @xl:inline">Fast</span>
        </Button>
      )}
    </div>
  );
}

function ModelEffortControl(props: AgentComposerControlsProps) {
  const [panel, setPanel] = useState<"root" | "model" | "effort">("root");
  const selectedModel = props.models.find(
    (model) =>
      model.provider === props.currentModel?.provider &&
      model.id === props.currentModel.id,
  );
  const modelLabel =
    selectedModel?.name ?? props.currentModel?.id ?? props.providerLabel;
  const effortLabel = props.thinkingLevel
    ? thinkingLabel(props.thinkingLevel)
    : null;
  const accessibleLabel = effortLabel
    ? `Model and effort: ${modelLabel}, ${effortLabel}`
    : `Model: ${modelLabel}`;
  const showEffort =
    props.thinkingLevels.length > 1 && props.thinkingLevel !== null;

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (!open) setPanel("root");
        props.onMenuOpenChange?.(open);
      }}
    >
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-32 gap-1.5 px-2 @lg:max-w-48 @2xl:max-w-56"
            disabled={props.disabled}
            aria-label={accessibleLabel}
            data-testid="agent-model-effort-trigger"
          />
        }
      >
        <ModelBrandIcon
          iconId={iconForModel(selectedModel)}
          className="size-4"
        />
        <span className="truncate">{modelLabel}</span>
        <ChevronDown className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6}>
          <Menu.Popup
            aria-label="Model and effort"
            className={cn(
              "z-50 max-h-[min(28rem,calc(100vh-2rem))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              panel === "model"
                ? "w-80"
                : panel === "effort"
                  ? "w-56"
                  : "w-72",
              motionClasses.popup,
            )}
          >
            {panel === "root" && (
              <>
                {props.models.length > 0 && (
                  <Menu.Item
                    closeOnClick={false}
                    onClick={() => setPanel("model")}
                    className={controlRowClassName}
                  >
                    <ModelBrandIcon
                      iconId={iconForModel(selectedModel)}
                      className="size-4"
                    />
                    <span className="font-medium">Model</span>
                    <span className="ml-auto min-w-0 truncate text-muted-foreground">
                      {modelLabel}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Menu.Item>
                )}
                {showEffort && (
                  <Menu.Item
                    closeOnClick={false}
                    onClick={() => setPanel("effort")}
                    className={controlRowClassName}
                  >
                    <BrainCircuit className="size-4 text-muted-foreground" />
                    <span className="font-medium">Effort</span>
                    <span className="ml-auto text-muted-foreground">
                      {effortLabel}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Menu.Item>
                )}
              </>
            )}
            {panel === "model" && (
              <>
                <BackItem label="Model" onClick={() => setPanel("root")} />
                <Menu.Separator className="mx-1 my-1 h-px bg-border" />
                {props.models.map((model) => {
                  const selected =
                    model.provider === props.currentModel?.provider &&
                    model.id === props.currentModel.id;
                  return (
                    <Menu.Item
                      key={`${model.provider}/${model.id}`}
                      onClick={() => props.onSelectModel(model)}
                      className={cn(
                        choiceItemClassName,
                        selected && "bg-accent text-accent-foreground",
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
                        {selected && <Check className="size-3.5" />}
                      </span>
                    </Menu.Item>
                  );
                })}
              </>
            )}
            {panel === "effort" && (
              <>
                <BackItem label="Effort" onClick={() => setPanel("root")} />
                <Menu.Separator className="mx-1 my-1 h-px bg-border" />
                {props.thinkingLevels.map((level) => (
                  <Menu.Item
                    key={level}
                    onClick={() => props.onSelectThinking(level)}
                    className={choiceItemClassName}
                  >
                    <BrainCircuit className="size-4 text-muted-foreground" />
                    <span className="flex-1">{thinkingLabel(level)}</span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {level === props.thinkingLevel && (
                        <Check className="size-3.5" />
                      )}
                    </span>
                  </Menu.Item>
                ))}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function BackItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      closeOnClick={false}
      onClick={onClick}
      aria-label="Back to model and effort"
      className={controlRowClassName}
    >
      <ArrowLeft className="size-4 text-muted-foreground" />
      <span className="font-medium">{label}</span>
    </Menu.Item>
  );
}

function PlanModeControl({
  disabled,
  onExit,
  onOpenChange,
}: {
  disabled: boolean;
  onExit: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root onOpenChange={onOpenChange}>
      <Menu.Trigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2"
            aria-label="Plan mode"
            aria-pressed="true"
            disabled={disabled}
          />
        }
      >
        <ListTodo className="size-3.5" />
        Plan
        <ChevronDown className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6}>
          <Menu.Popup
            aria-label="Plan mode"
            className={cn(
              "z-50 w-44 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <Menu.Item
              onClick={onExit}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <X className="size-3.5 text-muted-foreground" />
              Exit plan mode
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
