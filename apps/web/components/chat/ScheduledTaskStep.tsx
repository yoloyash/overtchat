"use client";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  scheduledTaskActivityLabel,
  type ScheduledTaskToolOutput,
  type ScheduledTaskToolPart,
  type ScheduledTaskToolTask,
} from "@overtchat/shared";

function TaskLine({ task }: { task: ScheduledTaskToolTask }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="min-w-0 truncate text-foreground">{task.name}</span>
      <span className="shrink-0 text-muted-foreground">
        {task.enabled
          ? task.schedule
          : t("chat.steps.schedulePaused", { schedule: task.schedule })}
      </span>
    </li>
  );
}

/**
 * One scheduled tasks tool call in the activity timeline: what was scheduled,
 * changed or deleted, or the tasks that were listed, with a way to the page
 * that manages them.
 */
export function ScheduledTaskStep({ part }: { part: ScheduledTaskToolPart }) {
  const { t } = useTranslation();
  const settled =
    part.state === "output-available" || part.state === "output-error";
  const output =
    part.state === "output-available" &&
    part.output !== null &&
    typeof part.output === "object"
      ? (part.output as ScheduledTaskToolOutput)
      : null;
  const tasks = output?.task
    ? output.deleted
      ? []
      : [output.task]
    : Array.isArray(output?.tasks)
      ? output.tasks
      : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {scheduledTaskActivityLabel(part, !settled, t)}
        </span>
        {output && (
          <Link
            to="/scheduled"
            className="shrink-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("chat.steps.viewTasks")}
          </Link>
        )}
      </div>
      {part.state === "output-error" && (
        <p className="text-destructive">{part.errorText}</p>
      )}
      {tasks.length > 0 && (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border bg-background/40">
          {tasks.map((task) => (
            <TaskLine key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}
