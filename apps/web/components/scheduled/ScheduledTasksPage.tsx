"use client";

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import {
  describeTaskSchedule,
  formatScheduledRunTime,
  formatUpdatedAt,
  SCHEDULED_TASK_RUN_LABELS,
  scheduledTaskIsCompleted,
  type ScheduledTask,
  type ScheduledTaskRun,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ScheduledTaskDialog } from "@/components/scheduled/ScheduledTaskDialog";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import {
  useDeleteScheduledTask,
  useRunScheduledTask,
  useScheduledTaskRuns,
  useScheduledTasks,
  useUpdateScheduledTask,
} from "@/lib/queries/scheduledTasks";
import { cn } from "@/lib/utils";

/** A moment on the task's own clock, naming the zone when it is not the reader's. */
function RunStatusIcon({ status }: { status: ScheduledTaskRun["status"] }) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "running":
      return (
        <LoaderCircle
          aria-hidden="true"
          className={cn(className, "text-muted-foreground", motionClasses.spinner)}
        />
      );
    case "success":
      return (
        <Check
          aria-hidden="true"
          className={cn(className, "text-green-600 dark:text-green-500")}
        />
      );
    case "error":
      return (
        <CircleAlert aria-hidden="true" className={cn(className, "text-destructive")} />
      );
    case "skipped":
      return (
        <CircleSlash
          aria-hidden="true"
          className={cn(className, "text-muted-foreground")}
        />
      );
    case "interrupted":
      return (
        <Square aria-hidden="true" className={cn(className, "text-muted-foreground")} />
      );
  }
}

function RunChatLink({
  run,
  children,
  className,
}: {
  run: ScheduledTaskRun;
  children: React.ReactNode;
  className?: string;
}) {
  if (!run.chatId) return <span className={className}>{children}</span>;
  return (
    <Link
      to="/chat/$id"
      params={{ id: run.chatId }}
      className={cn("underline-offset-4 hover:underline", className)}
    >
      {children}
    </Link>
  );
}

function TaskRuns({ task }: { task: ScheduledTask }) {
  const runs = useScheduledTaskRuns(task.id);
  if (runs.isPending) {
    return (
      <p role="status" className="py-2 text-xs text-muted-foreground">
        Loading runs…
      </p>
    );
  }
  if (runs.isError) {
    return (
      <p role="alert" className="py-2 text-xs text-muted-foreground">
        Could not load the runs.
      </p>
    );
  }
  if (runs.data.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        This task has not run yet.
      </p>
    );
  }
  return (
    <ul aria-label={`Runs of ${task.name}`} className="space-y-0.5">
      {runs.data.map((run) => (
        <li key={run.id} className="flex items-start gap-2 py-1 text-xs">
          <span className="mt-0.5">
            <RunStatusIcon status={run.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <RunChatLink run={run} className="font-medium text-foreground">
                {formatScheduledRunTime(run.startedAt, task.timeZone)}
              </RunChatLink>
              <span className="text-muted-foreground">
                {SCHEDULED_TASK_RUN_LABELS[run.status]}
                {run.trigger === "manual" && " · Run by hand"}
                {run.chatId && !run.seen && run.status !== "running" && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-green-700 dark:text-green-500">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-green-600 dark:bg-green-500"
                    />
                    New
                  </span>
                )}
              </span>
            </div>
            {run.error && (
              <p className="break-words text-muted-foreground">{run.error}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TaskStatus({ task }: { task: ScheduledTask }) {
  if (task.enabled && task.nextRunAt) {
    return <span>Next run {formatScheduledRunTime(task.nextRunAt, task.timeZone)}</span>;
  }
  if (task.pausedReason) {
    return (
      <span className="text-amber-700 dark:text-amber-500">
        {task.pausedReason}
      </span>
    );
  }
  return <span>{scheduledTaskIsCompleted(task) ? "Completed" : "Paused"}</span>;
}

function TaskRow({
  task,
  modelLabel,
  onEdit,
}: {
  task: ScheduledTask;
  modelLabel: string | undefined;
  onEdit: () => void;
}) {
  const updateTask = useUpdateScheduledTask();
  const runTask = useRunScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const running = task.lastRun?.status === "running";
  const lastRun = task.lastRun;

  function setEnabled(enabled: boolean) {
    updateTask.mutate(
      { id: task.id, patch: { enabled } },
      {
        onError: (error) =>
          toast.error({
            title: enabled ? "Could not turn the task on" : "Could not pause the task",
            description: getErrorMessage(error, "Try again."),
          }),
      },
    );
  }

  function runNow() {
    runTask.mutate(task.id, {
      onSuccess: () =>
        toast.success({
          title: "Running now",
          description: `${task.name} will open a new chat when it finishes.`,
        }),
      onError: (error) =>
        toast.error({
          title: "Could not run the task",
          description: getErrorMessage(error, "Try again."),
        }),
    });
  }

  const itemClass =
    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

  return (
    <li
      data-task-id={task.id}
      className="rounded-xl border bg-card px-4 py-3 text-card-foreground"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{task.name}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {describeTaskSchedule(task.schedule)}
            {modelLabel
              ? ` · ${modelLabel}`
              : task.modelConfigId === null
                ? " · Model removed"
                : ""}
          </p>
        </div>
        <Switch
          aria-label={`${task.name} is on`}
          checked={task.enabled}
          disabled={updateTask.isPending}
          onCheckedChange={setEnabled}
          className="mt-1"
        />
        <Menu.Root>
          <Menu.Trigger
            aria-label={`Actions for ${task.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground motion-colors hover:bg-accent hover:text-foreground max-md:size-9"
          >
            <MoreHorizontal className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4}>
              <Menu.Popup
                className={cn(
                  "z-50 w-40 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                  motionClasses.popup,
                )}
              >
                <Menu.Item
                  onClick={runNow}
                  disabled={running || runTask.isPending}
                  className={itemClass}
                >
                  <Play className="size-3.5" /> Run now
                </Menu.Item>
                <Menu.Item onClick={onEdit} className={itemClass}>
                  <Pencil className="size-3.5" /> Edit
                </Menu.Item>
                <Menu.Item
                  onClick={() => setDeleteOpen(true)}
                  className={cn(itemClass, "text-destructive data-[highlighted]:text-destructive")}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <TaskStatus task={task} />
        {lastRun && (
          <span className="inline-flex items-center gap-1.5">
            <RunStatusIcon status={lastRun.status} />
            <RunChatLink run={lastRun}>
              {lastRun.status === "running"
                ? "Running now"
                : `${SCHEDULED_TASK_RUN_LABELS[lastRun.status]} ${formatUpdatedAt(lastRun.startedAt).toLowerCase()}`}
            </RunChatLink>
          </span>
        )}
      </div>

      <button
        type="button"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((open) => !open)}
        className="mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground motion-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-3 motion-transform", historyOpen && "rotate-90")}
        />
        Runs
      </button>
      {historyOpen && (
        <div className="mt-1 border-t pt-2">
          <TaskRuns task={task} />
        </div>
      )}

      <AlertDialog.Root
        open={deleteOpen}
        onOpenChange={(open) => {
          if (open || !deleteTask.isPending) setDeleteOpen(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-50 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Delete task?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{task.name}</span>{" "}
              will stop running. The chats it wrote are kept.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={deleteTask.isPending} />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteTask.isPending}
                onClick={() =>
                  deleteTask.mutate(task.id, {
                    onSuccess: () => {
                      setDeleteOpen(false);
                      toast.success({ title: "Task deleted", description: task.name });
                    },
                    onError: (error) =>
                      toast.error({
                        title: "Could not delete the task",
                        description: getErrorMessage(error, "Try again."),
                      }),
                  })
                }
              >
                {deleteTask.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </li>
  );
}

/** The list of a person's scheduled tasks, with their runs. */
export function ScheduledTasksPage() {
  const tasks = useScheduledTasks();
  const { data: models } = useModelConfigs();
  const [editing, setEditing] = useState<ScheduledTask | "new" | null>(null);
  const list = tasks.data?.tasks ?? [];

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 px-4 pb-4 pt-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tasks run by themselves at the times you set. Each run opens a new
            chat.
          </p>
        </div>
        {list.length > 0 && (
          <Button size="sm" className="shrink-0" onClick={() => setEditing("new")}>
            <Plus /> New task
          </Button>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6"
        aria-busy={tasks.isFetching}
      >
        {tasks.isPending ? (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">
            Loading tasks…
          </p>
        ) : tasks.isError ? (
          <div role="alert" className="space-y-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Could not load your scheduled tasks.
            </p>
            <Button variant="outline" onClick={() => void tasks.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock aria-hidden="true" className="size-8 text-muted-foreground" />
            <p className="font-medium">No scheduled tasks yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create one here, or ask in any chat: “Every weekday at 8, send me
              a news briefing.”
            </p>
            <Button size="sm" className="mt-1" onClick={() => setEditing("new")}>
              <Plus /> New task
            </Button>
          </div>
        ) : (
          <ul aria-label="Scheduled tasks" className="space-y-2">
            {list.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                modelLabel={
                  models?.find((model) => model.id === task.modelConfigId)?.label
                }
                onEdit={() => setEditing(task)}
              />
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <ScheduledTaskDialog
          key={editing === "new" ? "new" : editing.id}
          task={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
