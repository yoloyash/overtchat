import {
  describeTaskSchedule,
  formatScheduledRunTime,
  formatUpdatedAt,
  SCHEDULED_TASK_RUN_LABELS,
  scheduledTaskIsCompleted,
  type ScheduledTask,
  type ScheduledTaskRun,
} from "@overtchat/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import {
  Label,
  QueryState,
  Row,
  Section,
  SettingsPage,
  useAction,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { useChatSession } from "@/lib/chat/session";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useProjects } from "@/lib/queries/projects";
import {
  useRunScheduledTask,
  useScheduledTaskRuns,
  useScheduledTasks,
  useUpdateScheduledTask,
} from "@/lib/queries/scheduledTasks";
import { useTheme } from "@/lib/theme";
import { toastSuccess } from "@/lib/toast";

/** What a task is waiting for: its next time, or why it has none. */
function taskStatus(task: ScheduledTask): string {
  if (task.enabled && task.nextRunAt) {
    return `Next run ${formatScheduledRunTime(task.nextRunAt, task.timeZone)}`;
  }
  if (task.pausedReason) return task.pausedReason;
  return scheduledTaskIsCompleted(task) ? "Completed" : "Paused";
}

function runDetail(run: ScheduledTaskRun): string {
  return [
    SCHEDULED_TASK_RUN_LABELS[run.status],
    run.trigger === "manual" ? "Run by hand" : null,
    run.chatId && !run.seen && run.status !== "running" ? "New" : null,
    run.error,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function Scheduled() {
  const tasks = useScheduledTasks();
  useRefreshOnFocus(tasks.refetch);
  const { data: models } = useModelConfigs();
  const { data: projects } = useProjects();
  return (
    <SettingsPage
      title="Scheduled"
      action={{
        label: "New task",
        icon: "add",
        onPress: () =>
          router.push({ pathname: "/scheduled/[id]", params: { id: "new" } }),
      }}
    >
      <Label muted>
        Tasks run by themselves at the times you set. Each run opens a new chat.
      </Label>
      <QueryState query={tasks} />
      {tasks.data?.tasks.length === 0 && (
        <Section>
          <Row
            title="No scheduled tasks yet"
            detail="Add one here, or ask in any chat: “Every weekday at 8, send me a news briefing.”"
          />
        </Section>
      )}
      {tasks.data?.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          model={models?.find((model) => model.id === task.modelConfigId)?.label}
          project={projects?.find((project) => project.id === task.projectId)?.name}
        />
      ))}
    </SettingsPage>
  );
}

function TaskCard({
  task,
  model,
  project,
}: {
  task: ScheduledTask;
  model?: string;
  project?: string;
}) {
  const { colors } = useTheme();
  const { openChat } = useChatSession();
  const updateTask = useUpdateScheduledTask();
  const runTask = useRunScheduledTask();
  const action = useAction();
  const [historyOpen, setHistoryOpen] = useState(false);
  const runs = useScheduledTaskRuns(task.id, historyOpen);
  const running = task.lastRun?.status === "running";
  const lastRun = task.lastRun;

  function open(chatId: string) {
    openChat(chatId);
    router.replace("/chat");
  }

  return (
    <View style={{ gap: 6 }}>
      <Section>
        <Row
          title={task.name}
          detail={[
            describeTaskSchedule(task.schedule),
            model ?? (task.modelConfigId === null ? "Model removed" : null),
            project,
          ]
            .filter(Boolean)
            .join(" · ")}
          status={<Label muted>{taskStatus(task)}</Label>}
        >
          <Switch
            accessibilityLabel={`Run ${task.name} on its schedule`}
            value={task.enabled}
            disabled={action.busy}
            trackColor={{ true: colors.primary }}
            onValueChange={(enabled) =>
              void action.run(async () => {
                await updateTask.mutateAsync({ id: task.id, patch: { enabled } });
              })
            }
          />
        </Row>
        {lastRun && (
          <Row
            icon={
              lastRun.status === "running"
                ? "sync-outline"
                : lastRun.status === "success"
                  ? "checkmark-circle-outline"
                  : lastRun.status === "error"
                    ? "alert-circle-outline"
                    : "remove-circle-outline"
            }
            title={
              lastRun.status === "running"
                ? "Running now"
                : `${SCHEDULED_TASK_RUN_LABELS[lastRun.status]} ${formatUpdatedAt(lastRun.startedAt).toLowerCase()}`
            }
            detail={lastRun.error ?? undefined}
            navigation={!!lastRun.chatId}
            onPress={lastRun.chatId ? () => open(lastRun.chatId as string) : undefined}
          />
        )}
        <Row
          icon="play-outline"
          title="Run now"
          disabled={running || action.busy}
          onPress={() =>
            void action.run(async () => {
              await runTask.mutateAsync(task.id);
              toastSuccess("Running now", `${task.name} will open a new chat when it finishes.`);
            })
          }
        />
        <Row
          icon="create-outline"
          title="Edit"
          navigation
          onPress={() =>
            router.push({ pathname: "/scheduled/[id]", params: { id: task.id } })
          }
        />
        <Row
          icon="time-outline"
          title="Runs"
          expanded={historyOpen}
          onPress={() => setHistoryOpen((open) => !open)}
        />
        {historyOpen &&
          (runs.data ? (
            runs.data.length === 0 ? (
              <Row title="This task has not run yet." />
            ) : (
              runs.data.map((run) => (
                <Row
                  key={run.id}
                  title={formatScheduledRunTime(run.startedAt, task.timeZone)}
                  detail={runDetail(run)}
                  navigation={!!run.chatId}
                  onPress={run.chatId ? () => open(run.chatId as string) : undefined}
                />
              ))
            )
          ) : (
            <Row title={runs.error ? "Could not load the runs." : "Loading runs…"} />
          ))}
      </Section>
      {!!action.error && <Label error>{action.error}</Label>}
    </View>
  );
}
