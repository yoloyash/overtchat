"use client";

import { Popover } from "@base-ui/react/popover";
import { ListChecks, Pause, Play, Target, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AgentGoal } from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import type { AgentTaskListSnapshot } from "@/lib/agents/presentation";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AgentTaskListRows } from "./AgentTaskList";

export function AgentSessionContext({
  goal,
  tasks,
  goalActionsDisabled,
  onPauseGoal,
  onResumeGoal,
  onClearGoal,
}: {
  goal: AgentGoal | null;
  tasks: AgentTaskListSnapshot | null;
  goalActionsDisabled: boolean;
  onPauseGoal: () => void;
  onResumeGoal: () => void;
  onClearGoal: () => void;
}) {
  if (!goal && !tasks?.tasks.length) return null;

  return (
    <div
      className="mb-2 flex min-h-7 flex-wrap items-center gap-2"
      data-testid="agent-session-context"
    >
      {goal && (
        <GoalContext
          goal={goal}
          disabled={goalActionsDisabled}
          onPause={onPauseGoal}
          onResume={onResumeGoal}
          onClear={onClearGoal}
        />
      )}
      {tasks && tasks.tasks.length > 0 && <TaskContext snapshot={tasks} />}
    </div>
  );
}

function GoalContext({
  goal,
  disabled,
  onPause,
  onResume,
  onClear,
}: {
  goal: AgentGoal;
  disabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const paused = goal.status === "paused";
  const status = t(`agents.context.goalStatus.${goal.status}`);

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("agents.context.goalAria", { status })}
          />
        }
      >
        <Target />
        {t("agents.context.goal")}
        <span className="font-normal text-muted-foreground">{status}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8}>
          <Popover.Popup
            className={cn(
              "z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
            data-testid="agent-goal-panel"
          >
            <div className="flex items-center gap-2">
              <Target className="size-4 text-muted-foreground" />
              <Popover.Title className="text-sm font-medium">
                {t("agents.context.goal")}
              </Popover.Title>
              <span className="ml-auto text-xs text-muted-foreground">
                {status}
              </span>
            </div>
            <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-relaxed">
              {goal.objective}
            </p>
            <GoalUsage goal={goal} />
            <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
              {paused ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("agents.context.resumeGoal")}
                  disabled={disabled}
                  onClick={onResume}
                >
                  <Play />
                  {t("agents.context.resume")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("agents.context.pauseGoal")}
                  disabled={disabled}
                  onClick={onPause}
                >
                  <Pause />
                  {t("agents.context.pause")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("agents.context.clearGoal")}
                disabled={disabled}
                onClick={onClear}
              >
                <X />
                {t("agents.context.clear")}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TaskContext({ snapshot }: { snapshot: AgentTaskListSnapshot }) {
  const { t } = useTranslation();
  const completed = snapshot.tasks.filter(
    (task) => task.status === "completed",
  ).length;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("agents.context.tasksAria", {
              completed,
              total: snapshot.tasks.length,
            })}
          />
        }
      >
        <ListChecks />
        {t("agents.context.tasks")}
        <span className="font-normal tabular-nums text-muted-foreground">
          {completed}/{snapshot.tasks.length}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8}>
          <Popover.Popup
            className={cn(
              "z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
            data-testid="agent-task-panel"
          >
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" />
              <Popover.Title className="text-sm font-medium">
                {t("agents.context.tasks")}
              </Popover.Title>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {t("agents.context.tasksComplete", {
                  completed,
                  total: snapshot.tasks.length,
                })}
              </span>
            </div>
            {snapshot.explanation && (
              <p className="mt-3 text-sm text-muted-foreground">
                {snapshot.explanation}
              </p>
            )}
            <div className="mt-3 border-t pt-3">
              <AgentTaskListRows tasks={snapshot.tasks} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GoalUsage({ goal }: { goal: AgentGoal }) {
  const { t } = useTranslation();
  const usage =
    goal.tokenBudget !== null
      ? t("agents.context.tokensBudget", {
          used: goal.tokensUsed.toLocaleString(),
          budget: goal.tokenBudget.toLocaleString(),
        })
      : goal.tokensUsed > 0
        ? t("agents.context.tokensUsed", {
            used: goal.tokensUsed.toLocaleString(),
          })
        : null;
  const elapsed = formatGoalElapsed(goal.timeUsedSeconds, t);
  if (!usage && !elapsed) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {usage && <span>{usage}</span>}
      {elapsed && <span>{elapsed}</span>}
    </div>
  );
}

function formatGoalElapsed(
  seconds: number,
  t: TFunction,
): string | null {
  if (seconds <= 0) return null;
  if (seconds < 60) {
    return t("agents.context.elapsedSeconds", {
      seconds: Math.floor(seconds),
    });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("agents.context.elapsedMinutes", { minutes });
  }
  const hours = Math.floor(minutes / 60);
  return t("agents.context.elapsedHoursMinutes", {
    hours,
    minutes: minutes % 60,
  });
}
