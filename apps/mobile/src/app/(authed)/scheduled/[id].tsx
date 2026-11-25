import { useTranslation } from "react-i18next";
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
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import {
  Action,
  Choice,
  Field,
  Label,
  QueryState,
  Row,
  Section,
  SettingsPage,
  Toggle,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useProjects } from "@/lib/queries/projects";
import {
  useCreateScheduledTask,
  useDeleteScheduledTask,
  useScheduledTasks,
  useUpdateScheduledTask,
} from "@/lib/queries/scheduledTasks";
import {
  dateOptions,
  dayOfMonthOptions,
  minuteOptions,
  timeOptions,
} from "@/lib/scheduledTaskForm";
import { useTheme } from "@/lib/theme";
import { toastSuccess } from "@/lib/toast";

const FREQUENCY_KEYS: Record<
  TaskScheduleFrequency,
  `scheduled.frequency.${TaskScheduleFrequency}`
> = {
  once: "scheduled.frequency.once",
  hourly: "scheduled.frequency.hourly",
  daily: "scheduled.frequency.daily",
  weekdays: "scheduled.frequency.weekdays",
  weekly: "scheduled.frequency.weekly",
  monthly: "scheduled.frequency.monthly",
};

const DAYS = [
  { shortKey: "scheduled.daysShort.sunday", nameKey: "scheduled.days.sunday" },
  { shortKey: "scheduled.daysShort.monday", nameKey: "scheduled.days.monday" },
  { shortKey: "scheduled.daysShort.tuesday", nameKey: "scheduled.days.tuesday" },
  { shortKey: "scheduled.daysShort.wednesday", nameKey: "scheduled.days.wednesday" },
  { shortKey: "scheduled.daysShort.thursday", nameKey: "scheduled.days.thursday" },
  { shortKey: "scheduled.daysShort.friday", nameKey: "scheduled.days.friday" },
  { shortKey: "scheduled.daysShort.saturday", nameKey: "scheduled.days.saturday" },
] as const;

/** The picker's value for a task outside any project. */
const NO_PROJECT = "none";

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export default function ScheduledTaskScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tasks = useScheduledTasks();
  const models = useModelConfigs();
  if (id === "new") {
    return models.data ? (
      <TaskForm key="new" task={null} />
    ) : (
      <SettingsPage title={t("scheduled.actions.newTask")}>
        <QueryState query={models} />
      </SettingsPage>
    );
  }
  const task = tasks.data?.tasks.find((item) => item.id === id);
  return task && models.data ? (
    <TaskForm key={task.id} task={task} />
  ) : (
    <SettingsPage title={t("scheduled.form.editTitle")}>
      <QueryState query={tasks.data ? models : tasks} />
      {tasks.data && !task && <Label>{t("scheduled.mobile.notFound")}</Label>}
    </SettingsPage>
  );
}

function TaskForm({ task }: { task: ScheduledTask | null }) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  const { data: models = [] } = useModelConfigs();
  const { data: projects = [] } = useProjects();
  const createTask = useCreateScheduledTask();
  const updateTask = useUpdateScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const action = useAction();
  const [draft, setDraft] = useState<ScheduledTaskDraft>(() =>
    task
      ? taskDraftOf(task)
      : emptyTaskDraft(models[0]?.id ?? "", deviceTimeZone()),
  );
  // What the server holds: the form as opened, then as last saved.
  const [saved, setSaved] = useState(() => JSON.stringify(draft));
  const [problem, setProblem] = useState("");
  // A new task is made once; the form then only offers the way back.
  const [created, setCreated] = useState(false);
  const changed = JSON.stringify(draft) !== saved;
  useUnsavedChanges(!created && changed);
  const change = (patch: Partial<ScheduledTaskDraft>) => {
    setProblem("");
    setDraft((current) => ({ ...current, ...patch }));
  };

  const ownZone = deviceTimeZone();
  const modelOptions = models.map((model) => ({ value: model.id, label: model.label }));
  const modelKnown = modelOptions.some((option) => option.value === draft.modelConfigId);

  function save() {
    const found = taskDraftProblem(draft);
    const schedule = scheduleOfDraft(draft);
    if (found || !schedule) {
      setProblem(found ?? t("scheduled.validation.missingTime"));
      return;
    }
    const input = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      modelConfigId: draft.modelConfigId,
      schedule,
      timeZone: draft.timeZone,
      webSearchEnabled: draft.webSearchEnabled,
      projectId: draft.projectId,
    };
    void action.run(async () => {
      if (task) await updateTask.mutateAsync({ id: task.id, patch: input });
      else await createTask.mutateAsync(input);
      setSaved(JSON.stringify(draft));
      setCreated(!task);
      toastSuccess(
        task ? t("scheduled.toast.updatedTitle") : t("scheduled.toast.createdTitle"),
        input.name,
      );
    });
  }

  return (
    <SettingsPage title={task ? t("scheduled.form.editTitle") : t("scheduled.actions.newTask")}>
      <Section description={t("scheduled.form.instructionsHint")}>
        <Field
          label={t("scheduled.form.name")}
          value={draft.name}
          maxLength={SCHEDULED_TASK_NAME_LIMIT}
          onChangeText={(name) => change({ name })}
          placeholder={t("scheduled.form.namePlaceholder")}
          autoCapitalize="sentences"
          autoCorrect
        />
        <Field
          label={t("scheduled.form.instructions")}
          value={draft.prompt}
          maxLength={SCHEDULED_TASK_PROMPT_LIMIT}
          onChangeText={(prompt) => change({ prompt })}
          placeholder={t("scheduled.form.instructionsPlaceholder")}
          multiline
          autoCapitalize="sentences"
          autoCorrect
        />
      </Section>

      <Section
        title={t("scheduled.mobile.whenSection")}
        description={
          draft.frequency === "monthly" && draft.dayOfMonth > 28
            ? t("scheduled.form.dayOfMonthHint")
            : undefined
        }
      >
        <Choice
          title={t("scheduled.form.repeats")}
          value={draft.frequency}
          options={TASK_SCHEDULE_FREQUENCIES.map((value) => ({
            value,
            label: t(FREQUENCY_KEYS[value]),
          }))}
          onChange={(frequency) => change({ frequency })}
        />
        {draft.frequency === "hourly" ? (
          <Choice
            title={t("scheduled.form.minutePastHour")}
            value={String(draft.minute).padStart(2, "0")}
            options={minuteOptions(draft.minute)}
            onChange={(minute) => change({ minute: Number(minute) })}
          />
        ) : (
          <Choice
            title={t("scheduled.form.time")}
            value={draft.time}
            options={timeOptions(draft.time)}
            onChange={(time) => change({ time })}
          />
        )}
        {draft.frequency === "once" && (
          <Choice
            title={t("scheduled.form.date")}
            value={draft.date}
            options={dateOptions(draft.date)}
            onChange={(date) => change({ date })}
          />
        )}
        {draft.frequency === "weekly" && (
          <View style={{ padding: 14, gap: 10 }}>
            <Label>{t("scheduled.form.daysOfWeek")}</Label>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {DAYS.map((day, index) => {
                const chosen = draft.daysOfWeek.includes(index);
                return (
                  <Pressable
                    key={day.nameKey}
                    accessibilityRole="checkbox"
                    accessibilityLabel={t(day.nameKey)}
                    accessibilityState={{ checked: chosen }}
                    onPress={() =>
                      change({
                        daysOfWeek: chosen
                          ? draft.daysOfWeek.filter((value) => value !== index)
                          : [...draft.daysOfWeek, index].sort((a, b) => a - b),
                      })
                    }
                    style={{
                      flex: 1,
                      maxWidth: 44,
                      aspectRatio: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: chosen ? colors.primary : colors.border,
                      backgroundColor: chosen ? colors.primary : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color: chosen ? colors.primaryForeground : colors.mutedForeground,
                        fontFamily: fonts.sansSemiBold,
                        fontSize: 14,
                      }}
                    >
                      {t(day.shortKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {draft.frequency === "monthly" && (
          <Choice
            title={t("scheduled.form.dayOfMonth")}
            value={String(draft.dayOfMonth).padStart(2, "0")}
            options={dayOfMonthOptions()}
            onChange={(day) => change({ dayOfMonth: Number(day) })}
          />
        )}
        <Row
          title={t("scheduled.form.timeZone")}
          value={draft.timeZone.replaceAll("_", " ")}
          detail={
            draft.timeZone === ownZone
              ? undefined
              : t("scheduled.mobile.usePhoneTimeZone", {
                  timeZone: ownZone.replaceAll("_", " "),
                })
          }
          onPress={
            draft.timeZone === ownZone ? undefined : () => change({ timeZone: ownZone })
          }
        />
      </Section>

      <Section title={t("scheduled.mobile.runsWithSection")}>
        <Choice
          title={t("scheduled.form.model")}
          value={modelKnown ? draft.modelConfigId : ""}
          options={
            modelKnown
              ? modelOptions
              : [{ value: "", label: t("scheduled.form.chooseModel") }, ...modelOptions]
          }
          onChange={(modelConfigId) => change({ modelConfigId })}
        />
        {(projects.length > 0 || draft.projectId) && (
          <Choice
            title={t("scheduled.form.project")}
            detail={t("scheduled.form.projectHint")}
            value={draft.projectId ?? NO_PROJECT}
            options={[
              { value: NO_PROJECT, label: t("scheduled.form.noProject") },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onChange={(value) =>
              change({ projectId: value === NO_PROJECT ? null : value })
            }
          />
        )}
        <Toggle
          title={t("scheduled.form.webSearch")}
          detail={t("scheduled.form.webSearchHint")}
          value={draft.webSearchEnabled}
          onChange={(webSearchEnabled) => change({ webSearchEnabled })}
        />
      </Section>

      {!!(problem || action.error) && <Label error>{problem || action.error}</Label>}
      <Action
        title={
          created
            ? t("scheduled.toast.createdTitle")
            : action.busy
              ? t("scheduled.form.saving")
              : task
                ? t("scheduled.form.save")
                : t("scheduled.form.schedule")
        }
        disabled={action.busy || created}
        onPress={save}
      />
      {created && (
        <Action secondary title={t("scheduled.mobile.backToTasks")} onPress={() => router.back()} />
      )}
      {task && (
        <Action
          title={t("scheduled.mobile.deleteTask")}
          destructive
          disabled={action.busy || changed}
          onPress={() =>
            Alert.alert(
              t("scheduled.deleteDialog.title"),
              t("scheduled.mobile.deleteDialogMessage", { name: task.name }),
              [
                { text: t("scheduled.actions.cancel"), style: "cancel" },
                {
                  text: t("scheduled.actions.delete"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(async () => {
                      await deleteTask.mutateAsync(task.id);
                      toastSuccess(t("scheduled.toast.deletedTitle"), task.name);
                      router.back();
                    }),
                },
              ],
            )
          }
        />
      )}
    </SettingsPage>
  );
}
