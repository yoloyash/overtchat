"use client";

import { CheckCircle2, Circle, Loader2, ListChecks } from "lucide-react";
import type {
  AgentTask,
  AgentTaskListSnapshot,
} from "@/lib/agents/presentation";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function AgentTaskListRows({ tasks }: { tasks: readonly AgentTask[] }) {
  return (
    <ol className="space-y-2" data-testid="agent-task-list">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex min-w-0 items-start gap-2 text-sm"
          data-task-status={task.status}
        >
          <TaskStatusIcon task={task} />
          <span
            className={cn(
              "min-w-0 flex-1 break-words",
              task.status === "completed" &&
                "text-muted-foreground line-through decoration-border",
              task.status === "in_progress" && "font-medium",
            )}
          >
            {task.step}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AgentTaskProgressCard({
  snapshot,
}: {
  snapshot: AgentTaskListSnapshot;
}) {
  const completed = snapshot.tasks.filter(
    (task) => task.status === "completed",
  ).length;

  return (
    <section
      className="overflow-hidden rounded-lg border bg-muted/15"
      data-testid="agent-task-progress-card"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Tasks</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {completed}/{snapshot.tasks.length}
        </span>
      </div>
      <div className="space-y-3 px-3 py-3">
        {snapshot.explanation && (
          <p className="text-sm text-muted-foreground">
            {snapshot.explanation}
          </p>
        )}
        <AgentTaskListRows tasks={snapshot.tasks} />
      </div>
    </section>
  );
}

function TaskStatusIcon({ task }: { task: AgentTask }) {
  if (task.status === "completed") {
    return (
      <CheckCircle2
        className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-label="Completed"
      />
    );
  }
  if (task.status === "in_progress") {
    return (
      <Loader2
        className={cn(
          "mt-0.5 size-4 shrink-0 text-foreground",
          motionClasses.spinner,
        )}
        aria-label="In progress"
      />
    );
  }
  return (
    <Circle
      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      aria-label="Pending"
    />
  );
}
