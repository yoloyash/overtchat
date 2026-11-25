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

const FREQUENCIES: { value: TaskScheduleFrequency; label: string }[] =
  TASK_SCHEDULE_FREQUENCIES.map((value) => ({
    value,
    label: {
      once: "Once",
      hourly: "Hourly",
      daily: "Daily",
      weekdays: "Weekdays",
      weekly: "Weekly",
      monthly: "Monthly",
    }[value],
  }));

const DAYS = [
  { short: "S", name: "Sunday" },
  { short: "M", name: "Monday" },
  { short: "T", name: "Tuesday" },
  { short: "W", name: "Wednesday" },
  { short: "T", name: "Thursday" },
  { short: "F", name: "Friday" },
  { short: "S", name: "Saturday" },
];

/** The picker's value for a task outside any project. */
const NO_PROJECT = "none";

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export default function ScheduledTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tasks = useScheduledTasks();
  const models = useModelConfigs();
  if (id === "new") {
    return models.data ? (
      <TaskForm key="new" task={null} />
    ) : (
      <SettingsPage title="New task">
        <QueryState query={models} />
      </SettingsPage>
    );
  }
  const task = tasks.data?.tasks.find((item) => item.id === id);
  return task && models.data ? (
    <TaskForm key={task.id} task={task} />
  ) : (
    <SettingsPage title="Edit task">
      <QueryState query={tasks.data ? models : tasks} />
      {tasks.data && !task && <Label>This task no longer exists.</Label>}
    </SettingsPage>
  );
}

function TaskForm({ task }: { task: ScheduledTask | null }) {
  const { colors, fonts } = useTheme();
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
      setProblem(found ?? "Choose a time.");
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
      toastSuccess(task ? "Task updated" : "Task scheduled", input.name);
    });
  }

  return (
    <SettingsPage title={task ? "Edit task" : "New task"}>
      <Section description="Each run starts fresh, so say everything it needs to know.">
        <Field
          label="Name"
          value={draft.name}
          maxLength={SCHEDULED_TASK_NAME_LIMIT}
          onChangeText={(name) => change({ name })}
          placeholder="Morning news briefing"
          autoCapitalize="sentences"
          autoCorrect
        />
        <Field
          label="Instructions"
          value={draft.prompt}
          maxLength={SCHEDULED_TASK_PROMPT_LIMIT}
          onChangeText={(prompt) => change({ prompt })}
          placeholder="Search for today's top technology news and summarize the five most important stories."
          multiline
          autoCapitalize="sentences"
          autoCorrect
        />
      </Section>

      <Section
        title="When"
        description={
          draft.frequency === "monthly" && draft.dayOfMonth > 28
            ? "A month without this day is skipped."
            : undefined
        }
      >
        <Choice
          title="Repeats"
          value={draft.frequency}
          options={FREQUENCIES}
          onChange={(frequency) => change({ frequency })}
        />
        {draft.frequency === "hourly" ? (
          <Choice
            title="Minute past the hour"
            value={String(draft.minute).padStart(2, "0")}
            options={minuteOptions(draft.minute)}
            onChange={(minute) => change({ minute: Number(minute) })}
          />
        ) : (
          <Choice
            title="Time"
            value={draft.time}
            options={timeOptions(draft.time)}
            onChange={(time) => change({ time })}
          />
        )}
        {draft.frequency === "once" && (
          <Choice
            title="Date"
            value={draft.date}
            options={dateOptions(draft.date)}
            onChange={(date) => change({ date })}
          />
        )}
        {draft.frequency === "weekly" && (
          <View style={{ padding: 14, gap: 10 }}>
            <Label>On</Label>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {DAYS.map((day, index) => {
                const chosen = draft.daysOfWeek.includes(index);
                return (
                  <Pressable
                    key={day.name}
                    accessibilityRole="checkbox"
                    accessibilityLabel={day.name}
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
                      {day.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {draft.frequency === "monthly" && (
          <Choice
            title="Day of the month"
            value={String(draft.dayOfMonth).padStart(2, "0")}
            options={dayOfMonthOptions()}
            onChange={(day) => change({ dayOfMonth: Number(day) })}
          />
        )}
        <Row
          title="Time zone"
          value={draft.timeZone.replaceAll("_", " ")}
          detail={
            draft.timeZone === ownZone
              ? undefined
              : `Tap to use this phone's time zone, ${ownZone.replaceAll("_", " ")}.`
          }
          onPress={
            draft.timeZone === ownZone ? undefined : () => change({ timeZone: ownZone })
          }
        />
      </Section>

      <Section title="Runs with">
        <Choice
          title="Model"
          value={modelKnown ? draft.modelConfigId : ""}
          options={
            modelKnown
              ? modelOptions
              : [{ value: "", label: "Choose a model" }, ...modelOptions]
          }
          onChange={(modelConfigId) => change({ modelConfigId })}
        />
        {(projects.length > 0 || draft.projectId) && (
          <Choice
            title="Project"
            detail="Runs start in the project, with its instructions and files."
            value={draft.projectId ?? NO_PROJECT}
            options={[
              { value: NO_PROJECT, label: "None" },
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
          title="Web search"
          detail="Let runs search the web and read pages."
          value={draft.webSearchEnabled}
          onChange={(webSearchEnabled) => change({ webSearchEnabled })}
        />
      </Section>

      {!!(problem || action.error) && <Label error>{problem || action.error}</Label>}
      <Action
        title={
          created ? "Task scheduled" : action.busy ? "Saving…" : task ? "Save" : "Schedule"
        }
        disabled={action.busy || created}
        onPress={save}
      />
      {created && (
        <Action secondary title="Back to tasks" onPress={() => router.back()} />
      )}
      {task && (
        <Action
          title="Delete task"
          destructive
          disabled={action.busy || changed}
          onPress={() =>
            Alert.alert(
              "Delete task?",
              `${task.name} will stop running. The chats it wrote are kept.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    void action.run(async () => {
                      await deleteTask.mutateAsync(task.id);
                      toastSuccess("Task deleted", task.name);
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
