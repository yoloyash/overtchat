"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { Button } from "@/components/ui/button";
import type {
  AgentCollaborationMode,
  AgentMode,
  AgentModel,
  AgentSelectOption,
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
  thinkingOptions: AgentSelectOption[];
  collaborationMode: AgentCollaborationMode;
  collaborationModes: AgentCollaborationMode[];
  fastModeEnabled: boolean;
  fastModeAvailable: boolean;
  modeId: string;
  modes: AgentMode[];
  disabled: boolean;
  onSelectModel: (model: AgentModel) => void;
  onSelectThinking: (level: AgentThinkingLevel) => void;
  onSelectCollaborationMode: (mode: AgentCollaborationMode) => void;
  onToggleFastMode: (enabled: boolean) => void;
  onSelectMode: (modeId: string) => void;
  onMenuOpenChange?: (open: boolean) => void;
}

const controlRowClassName =
  "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground";

const choiceItemClassName =
  "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

export function AgentComposerControls(props: AgentComposerControlsProps) {
  const hasModelOrEffort =
    props.models.length > 0 ||
    (props.thinkingOptions.length > 1 && props.thinkingLevel !== null);
  const hasControls =
    hasModelOrEffort ||
    props.modes.length > 0 ||
    props.collaborationMode === "plan" ||
    props.fastModeEnabled;

  if (!hasControls) return null;

  return (
    <div
      data-testid="agent-composer-controls"
      className="flex min-w-0 items-center gap-0.5"
    >
      {hasModelOrEffort && <ModelEffortControl {...props} />}
      {props.modes.length > 0 && <ModeControl {...props} />}
      {props.collaborationMode === "plan" && (
        <PlanModeControl
          disabled={props.disabled}
          onExit={() => props.onSelectCollaborationMode("default")}
          onOpenChange={props.onMenuOpenChange}
        />
      )}
      {props.fastModeEnabled && props.fastModeAvailable && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2"
          aria-pressed={props.fastModeEnabled}
          aria-label="Fast"
          title="Fast mode uses priority inference at higher usage"
          disabled={props.disabled}
          onClick={() => props.onToggleFastMode(false)}
        >
          <Zap className="size-3.5" />
          <span className="hidden @xl:inline">Fast</span>
        </Button>
      )}
    </div>
  );
}

function ModeControl(props: AgentComposerControlsProps) {
  const [fullAccessOpen, setFullAccessOpen] = useState(false);
  const selected =
    props.modes.find((mode) => mode.id === props.modeId) ?? props.modes[0];
  if (!selected) return null;
  const dangerous = selected.dangerous === true;

  function select(mode: AgentMode) {
    if (mode.id === props.modeId) return;
    if (mode.dangerous) {
      setFullAccessOpen(true);
      return;
    }
    props.onSelectMode(mode.id);
  }

  return (
    <>
      <Menu.Root onOpenChange={props.onMenuOpenChange}>
        <Menu.Trigger
          render={
            <Button
              type="button"
              variant={dangerous ? "destructive" : "ghost"}
              size="sm"
              className="h-7 min-w-0 max-w-40 gap-1.5 px-2"
              aria-label={`Permissions: ${selected.label}`}
              data-testid="agent-access-mode-trigger"
              disabled={props.disabled}
            />
          }
        >
          {dangerous ? (
            <ShieldAlert className="size-3.5" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          <span className="hidden truncate @xl:inline">{selected.label}</span>
          <ChevronDown className="hidden @xl:block" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="start" sideOffset={6}>
            <Menu.Popup
              aria-label="Permissions"
              className={cn(
                "z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                motionClasses.popup,
              )}
            >
              {props.modes.map((mode) => {
                const isDangerous = mode.dangerous === true;
                return (
                  <Menu.Item
                    key={mode.id}
                    onClick={() => select(mode)}
                    className={cn(
                      choiceItemClassName,
                      isDangerous &&
                        "text-destructive data-[highlighted]:text-destructive",
                    )}
                  >
                    {isDangerous ? (
                      <ShieldAlert className="size-4 shrink-0" />
                    ) : (
                      <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{mode.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {mode.description}
                      </span>
                    </span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {mode.id === props.modeId && (
                        <Check className="size-3.5" />
                      )}
                    </span>
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <AlertDialog.Root open={fullAccessOpen} onOpenChange={setFullAccessOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-50 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Enable Full access?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              Codex will be able to run commands and modify files without
              sandbox restrictions or approval prompts.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={<Button variant="ghost" size="sm" />}
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setFullAccessOpen(false);
                  const dangerousMode = props.modes.find(
                    (mode) => mode.dangerous,
                  );
                  if (dangerousMode) props.onSelectMode(dangerousMode.id);
                }}
              >
                Enable Full access
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
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
    selectedModel?.label ?? props.currentModel?.id ?? props.providerLabel;
  const effortLabel = props.thinkingLevel
    ? thinkingLabel(props.thinkingLevel)
    : null;
  const accessibleLabel = effortLabel
    ? `Model and effort: ${modelLabel}, ${effortLabel}`
    : `Model: ${modelLabel}`;
  const showEffort =
    props.thinkingOptions.length > 1 && props.thinkingLevel !== null;

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
                        <span className="block truncate">{model.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {model.description ?? model.id}
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
                {props.thinkingOptions.map((option) => (
                  <Menu.Item
                    key={option.id}
                    onClick={() => props.onSelectThinking(option.id)}
                    className={choiceItemClassName}
                  >
                    <BrainCircuit className="size-4 text-muted-foreground" />
                    <span className="flex-1">{option.label}</span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {option.id === props.thinkingLevel && (
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
