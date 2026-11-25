import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  describeTaskSchedule,
  formatScheduledRunTime,
  formatUpdatedAt,
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
function taskStatus(task: ScheduledTask, t: TFunction): string {
  if (task.enabled && task.nextRunAt) {
    return t("scheduled.status.nextRun", {
      time: formatScheduledRunTime(task.nextRunAt, task.timeZone),
    });
  }
  if (task.pausedReason) return task.pausedReason;
  return scheduledTaskIsCompleted(task)
    ? t("scheduled.status.completed")
    : t("scheduled.status.paused");
}

function runDetail(run: ScheduledTaskRun, t: TFunction): string {
  const status = t(`scheduled.runs.status.${run.status}`);
  return [
    run.trigger === "manual"
      ? t("scheduled.runs.statusManual", { status })
      : status,
    run.chatId && !run.seen && run.status !== "running"
      ? t("scheduled.runs.new")
      : null,
    run.error,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function Scheduled() {
  const { t } = useTranslation();
  const tasks = useScheduledTasks();
  useRefreshOnFocus(tasks.refetch);
  const { data: models } = useModelConfigs();
  const { data: projects } = useProjects();
  return (
    <SettingsPage
      title={t("scheduled.page.title")}
      action={{
        label: t("scheduled.actions.newTask"),
        icon: "add",
        onPress: () =>
          router.push({ pathname: "/scheduled/[id]", params: { id: "new" } }),
      }}
    >
      <Label muted>
        {t("scheduled.page.description")}
      </Label>
      <QueryState query={tasks} />
      {tasks.data?.tasks.length === 0 && (
        <Section>
          <Row
            title={t("scheduled.empty.title")}
            detail={t("scheduled.mobile.emptyDescription")}
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
  const { t } = useTranslation();
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
            model ??
              (task.modelConfigId === null
                ? t("scheduled.task.modelRemoved")
                : null),
            project,
          ]
            .filter(Boolean)
            .join(" · ")}
          status={<Label muted>{taskStatus(task, t)}</Label>}
        >
          <Switch
            accessibilityLabel={t("scheduled.mobile.runOnScheduleLabel", {
              name: task.name,
            })}
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
                ? t("scheduled.runs.runningNow")
                : t(`scheduled.runs.lastRun.${lastRun.status}`, {
                    time: formatUpdatedAt(lastRun.startedAt, undefined, {
                      inline: true,
                    }),
                  })
            }
            detail={lastRun.error ?? undefined}
            navigation={!!lastRun.chatId}
            onPress={lastRun.chatId ? () => open(lastRun.chatId as string) : undefined}
          />
        )}
        <Row
          icon="play-outline"
          title={t("scheduled.actions.runNow")}
          disabled={running || action.busy}
          onPress={() =>
            void action.run(async () => {
              await runTask.mutateAsync(task.id);
              toastSuccess(
                t("scheduled.toast.runningTitle"),
                t("scheduled.toast.runningDescription", { name: task.name }),
              );
            })
          }
        />
        <Row
          icon="create-outline"
          title={t("scheduled.actions.edit")}
          navigation
          onPress={() =>
            router.push({ pathname: "/scheduled/[id]", params: { id: task.id } })
          }
        />
        <Row
          icon="time-outline"
          title={t("scheduled.runs.toggle")}
          expanded={historyOpen}
          onPress={() => setHistoryOpen((open) => !open)}
        />
        {historyOpen &&
          (runs.data ? (
            runs.data.length === 0 ? (
              <Row title={t("scheduled.runs.empty")} />
            ) : (
              runs.data.map((run) => (
                <Row
                  key={run.id}
                  title={formatScheduledRunTime(run.startedAt, task.timeZone)}
                  detail={runDetail(run, t)}
                  navigation={!!run.chatId}
                  onPress={run.chatId ? () => open(run.chatId as string) : undefined}
                />
              ))
            )
          ) : (
            <Row
              title={
                runs.error
                  ? t("scheduled.runs.loadError")
                  : t("scheduled.runs.loading")
              }
            />
          ))}
      </Section>
      {!!action.error && <Label error>{action.error}</Label>}
    </View>
  );
}
