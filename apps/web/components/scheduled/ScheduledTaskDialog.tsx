"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  emptyTaskDraft,
  SCHEDULED_TASK_NAME_LIMIT,
  SCHEDULED_TASK_PROMPT_LIMIT,
  scheduleOfDraft,
  TASK_SCHEDULE_FREQUENCIES,
  taskDraftOf,
  taskDraftProblem,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type TaskScheduleFrequency,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useModelPreferences } from "@/lib/queries/modelPreferences";
import {
  useCreateScheduledTask,
  useUpdateScheduledTask,
} from "@/lib/queries/scheduledTasks";
import { cn } from "@/lib/utils";

const FREQUENCY_LABELS: Record<TaskScheduleFrequency, string> = {
  once: "Once",
  hourly: "Hourly",
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
};

const DAYS = [
  { short: "S", name: "Sunday" },
  { short: "M", name: "Monday" },
  { short: "T", name: "Tuesday" },
  { short: "W", name: "Wednesday" },
  { short: "T", name: "Thursday" },
  { short: "F", name: "Friday" },
  { short: "S", name: "Saturday" },
];

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timeZones(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set([current, browserTimeZone(), "UTC", ...supported])];
}

/** Creates a task, or edits the one given. Mount it only while it is open. */
export function ScheduledTaskDialog({
  task,
  onClose,
}: {
  task: ScheduledTask | null;
  onClose: () => void;
}) {
  const { data: models } = useModelConfigs();
  const { data: preferences } = useModelPreferences();
  const createTask = useCreateScheduledTask();
  const updateTask = useUpdateScheduledTask();
  const [edited, setEdited] = useState<ScheduledTaskDraft | null>(null);
  const [error, setError] = useState("");
  const [zoneQuery, setZoneQuery] = useState("");

  // A new task starts on the person's default model once the list arrives.
  const initial = useMemo(
    () =>
      task
        ? taskDraftOf(task)
        : emptyTaskDraft(
            (models?.find((model) => model.id === preferences?.defaultModelId) ??
              models?.[0])?.id ?? "",
            browserTimeZone(),
          ),
    [models, preferences?.defaultModelId, task],
  );
  const draft = edited ?? initial;
  const change = (patch: Partial<ScheduledTaskDraft>) => {
    setError("");
    setEdited({ ...draft, ...patch });
  };

  const zones = useMemo(() => timeZones(draft.timeZone), [draft.timeZone]);
  const matchingZones = useMemo(() => {
    const query = zoneQuery.trim().toLowerCase().replace(/\s+/g, "_");
    return query
      ? zones.filter((zone) => zone.toLowerCase().includes(query))
      : zones;
  }, [zoneQuery, zones]);
  const pending = createTask.isPending || updateTask.isPending;
  const modelMissing =
    models !== undefined &&
    !models.some((model) => model.id === draft.modelConfigId);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const problem = taskDraftProblem(draft);
    const schedule = scheduleOfDraft(draft);
    if (problem || !schedule) {
      setError(problem ?? "Choose a time.");
      return;
    }
    const input = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      modelConfigId: draft.modelConfigId,
      schedule,
      timeZone: draft.timeZone,
      webSearchEnabled: draft.webSearchEnabled,
    };
    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, patch: input });
        toast.success({ title: "Task updated", description: input.name });
      } else {
        await createTask.mutateAsync(input);
        toast.success({ title: "Task scheduled", description: input.name });
      }
      onClose();
    } catch (cause) {
      setError(getErrorMessage(cause, "Could not save the task."));
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <div className="shrink-0 px-6 pt-6">
            <Dialog.Title className="text-lg font-semibold tracking-tight">
              {task ? "Edit task" : "New scheduled task"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              The instructions run by themselves at the times you choose. Each
              run opens a new chat.
            </Dialog.Description>
          </div>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="task-name">Name</Label>
                <Input
                  id="task-name"
                  autoFocus={!task}
                  maxLength={SCHEDULED_TASK_NAME_LIMIT}
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                  placeholder="Morning news briefing"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-prompt">Instructions</Label>
                <Textarea
                  id="task-prompt"
                  rows={5}
                  maxLength={SCHEDULED_TASK_PROMPT_LIMIT}
                  value={draft.prompt}
                  onChange={(event) => change({ prompt: event.target.value })}
                  placeholder="Search for today's top technology news and summarize the five most important stories."
                  className="max-h-60 min-h-24"
                />
                <p className="text-xs text-muted-foreground">
                  Each run starts fresh, so say everything it needs to know.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="task-frequency">Repeats</Label>
                  <Select
                    value={draft.frequency}
                    onValueChange={(value) =>
                      change({ frequency: value as TaskScheduleFrequency })
                    }
                  >
                    <SelectTrigger id="task-frequency" className="w-full">
                      <SelectValue>{FREQUENCY_LABELS[draft.frequency]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_SCHEDULE_FREQUENCIES.map((frequency) => (
                        <SelectItem key={frequency} value={frequency}>
                          {FREQUENCY_LABELS[frequency]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {draft.frequency === "hourly" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-minute">Minute past the hour</Label>
                    <Input
                      id="task-minute"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      value={draft.minute}
                      onChange={(event) =>
                        change({
                          minute: Math.min(
                            59,
                            Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                          ),
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="task-time">Time</Label>
                    <Input
                      id="task-time"
                      type="time"
                      required
                      value={draft.time}
                      onChange={(event) => change({ time: event.target.value })}
                    />
                  </div>
                )}
              </div>

              {draft.frequency === "once" && (
                <div className="space-y-1.5">
                  <Label htmlFor="task-date">Date</Label>
                  <Input
                    id="task-date"
                    type="date"
                    required
                    value={draft.date}
                    onChange={(event) => change({ date: event.target.value })}
                  />
                </div>
              )}
              {draft.frequency === "weekly" && (
                <div className="space-y-1.5">
                  <span id="task-days-label" className="text-sm font-medium">
                    On
                  </span>
                  <div
                    role="group"
                    aria-labelledby="task-days-label"
                    className="flex gap-1.5"
                  >
                    {DAYS.map((day, index) => {
                      const chosen = draft.daysOfWeek.includes(index);
                      return (
                        <button
                          key={day.name}
                          type="button"
                          aria-label={day.name}
                          aria-pressed={chosen}
                          onClick={() =>
                            change({
                              daysOfWeek: chosen
                                ? draft.daysOfWeek.filter((value) => value !== index)
                                : [...draft.daysOfWeek, index].sort((a, b) => a - b),
                            })
                          }
                          className={cn(
                            "flex size-9 items-center justify-center rounded-full border text-sm font-medium motion-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                            chosen
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {draft.frequency === "monthly" && (
                <div className="space-y-1.5">
                  <Label htmlFor="task-day">Day of the month</Label>
                  <Input
                    id="task-day"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={draft.dayOfMonth}
                    onChange={(event) =>
                      change({
                        dayOfMonth: Math.min(
                          31,
                          Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                        ),
                      })
                    }
                  />
                  {draft.dayOfMonth > 28 && (
                    <p className="text-xs text-muted-foreground">
                      A month without this day is skipped.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="task-zone">Time zone</Label>
                <Combobox
                  items={zones}
                  filteredItems={matchingZones}
                  inputValue={zoneQuery}
                  onInputValueChange={setZoneQuery}
                  onOpenChange={(open) => {
                    if (open) setZoneQuery("");
                  }}
                  value={draft.timeZone}
                  onValueChange={(value) => {
                    if (value) change({ timeZone: value });
                  }}
                  autoHighlight
                >
                  <ComboboxTrigger id="task-zone" className="w-full">
                    <span className="min-w-0 flex-1 truncate text-left">
                      {draft.timeZone.replaceAll("_", " ")}
                    </span>
                  </ComboboxTrigger>
                  <ComboboxContent aria-label="Time zones">
                    <ComboboxInput
                      placeholder="Search time zones"
                      aria-label="Search time zones"
                    />
                    <ComboboxEmpty>No matching time zone.</ComboboxEmpty>
                    <ComboboxList>
                      {(zone: string) => (
                        <ComboboxItem key={zone} value={zone}>
                          <span className="min-w-0 truncate">
                            {zone.replaceAll("_", " ")}
                          </span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-model">Model</Label>
                <Select
                  value={modelMissing ? "" : draft.modelConfigId}
                  onValueChange={(value) =>
                    change({ modelConfigId: value as string })
                  }
                >
                  <SelectTrigger id="task-model" className="w-full">
                    <SelectValue>
                      {models?.find((model) => model.id === draft.modelConfigId)
                        ?.label ?? (
                        <span className="text-muted-foreground">
                          {models?.length === 0
                            ? "No models configured"
                            : "Choose a model"}
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(models ?? []).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="task-search">Web search</Label>
                  <p className="text-xs text-muted-foreground">
                    Let runs search the web and read pages.
                  </p>
                </div>
                <Switch
                  id="task-search"
                  checked={draft.webSearchEnabled}
                  onCheckedChange={(checked) =>
                    change({ webSearchEnabled: checked })
                  }
                />
              </div>
            </div>

            <div className="shrink-0 border-t px-6 py-4">
              {error && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Saving…" : task ? "Save" : "Schedule"}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
