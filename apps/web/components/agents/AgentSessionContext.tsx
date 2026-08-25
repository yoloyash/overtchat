"use client";

import { Popover } from "@base-ui/react/popover";
import { ListChecks, Pause, Play, Target, X } from "lucide-react";
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
  const paused = goal.status === "paused";
  const status = humanizeGoalStatus(goal.status);

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Goal, ${status}`}
          />
        }
      >
        <Target />
        Goal
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
                Goal
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
                  aria-label="Resume goal"
                  disabled={disabled}
                  onClick={onResume}
                >
                  <Play />
                  Resume
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Pause goal"
                  disabled={disabled}
                  onClick={onPause}
                >
                  <Pause />
                  Pause
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Clear goal"
                disabled={disabled}
                onClick={onClear}
              >
                <X />
                Clear
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TaskContext({ snapshot }: { snapshot: AgentTaskListSnapshot }) {
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
            aria-label={`${completed} of ${snapshot.tasks.length} tasks complete`}
          />
        }
      >
        <ListChecks />
        Tasks
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
                Tasks
              </Popover.Title>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {completed}/{snapshot.tasks.length} complete
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
  const usage =
    goal.tokenBudget !== null
      ? `${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens`
      : goal.tokensUsed > 0
        ? `${goal.tokensUsed.toLocaleString()} tokens`
        : null;
  const elapsed = formatGoalElapsed(goal.timeUsedSeconds);
  if (!usage && !elapsed) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {usage && <span>{usage}</span>}
      {elapsed && <span>{elapsed}</span>}
    </div>
  );
}

function humanizeGoalStatus(value: AgentGoal["status"]): string {
  return value.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
}

function formatGoalElapsed(seconds: number): string | null {
  if (seconds <= 0) return null;
  if (seconds < 60) return `${Math.floor(seconds)}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m elapsed`;
}
