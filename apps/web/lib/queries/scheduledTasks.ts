"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ScheduledTask,
  ScheduledTaskActivityResponse,
  ScheduledTaskActivityRun,
  ScheduledTaskInput,
  ScheduledTaskListResponse,
  ScheduledTaskPatch,
  ScheduledTaskRun,
} from "@overtchat/shared";
import { apiUrl } from "@/lib/api-url";
import { chatKeys, scheduledTaskKeys } from "@/lib/queries/keys";

/** How often an open page asks whether a run started or finished. */
export const SCHEDULED_TASK_ACTIVITY_POLL_MS = 30_000;
/** While a run is going, so the page learns it finished soon after it does. */
export const SCHEDULED_TASK_RUNNING_POLL_MS = 3_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    ...(init?.body ? { headers: { "Content-Type": "application/json" } } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const scheduledTaskListQuery = queryOptions({
  queryKey: scheduledTaskKeys.list(),
  queryFn: () => request<ScheduledTaskListResponse>("/api/scheduled-tasks"),
});

/** The list for the Scheduled page: asked for anew each time it opens. */
export function useScheduledTasks() {
  return useQuery({ ...scheduledTaskListQuery, refetchOnMount: "always" });
}

export function useScheduledTaskRuns(id: string, enabled = true) {
  return useQuery({
    queryKey: scheduledTaskKeys.runs(id),
    queryFn: async () =>
      (
        await request<{ runs: ScheduledTaskRun[] }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}/runs`,
        )
      ).runs,
    enabled,
  });
}

export function scheduledTaskActivityInterval(
  runs: ScheduledTaskActivityRun[] | undefined,
): number {
  return runs?.some((run) => run.status === "running")
    ? SCHEDULED_TASK_RUNNING_POLL_MS
    : SCHEDULED_TASK_ACTIVITY_POLL_MS;
}

/**
 * Runs in progress and finished runs nobody has opened. Nothing pushes these
 * to a page: a run starts on the server's clock, so the page asks.
 */
export function useScheduledTaskActivity(
  enabled: boolean,
  /** Keep asking while the page is hidden, for a page that will alert. */
  whileHidden = false,
) {
  return useQuery({
    queryKey: scheduledTaskKeys.activity(),
    queryFn: async () =>
      (
        await request<ScheduledTaskActivityResponse>(
          "/api/scheduled-tasks/activity",
        )
      ).runs,
    enabled,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => scheduledTaskActivityInterval(query.state.data),
    refetchIntervalInBackground: whileHidden,
    retry: false,
  });
}

function invalidateTasks(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.all() });
}

export function useCreateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduledTaskInput) =>
      (
        await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).task,
    onSuccess: () => invalidateTasks(queryClient),
  });
}

export function useUpdateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ScheduledTaskPatch }) =>
      (
        await request<{ task: ScheduledTask }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify(patch) },
        )
      ).task,
    onSuccess: () => invalidateTasks(queryClient),
  });
}

export function useDeleteScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateTasks(queryClient),
  });
}

export function useRunScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await request<{ run: ScheduledTaskRun }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}/run`,
          { method: "POST" },
        )
      ).run,
    onSuccess: () => invalidateTasks(queryClient),
  });
}

/** Tells the server a run's chat has been opened, and drops its marker here. */
export async function markScheduledRunsSeen(
  queryClient: QueryClient,
  chatId: string,
): Promise<void> {
  queryClient.setQueryData<ScheduledTaskActivityRun[]>(
    scheduledTaskKeys.activity(),
    (runs) =>
      runs?.filter((run) => run.chatId !== chatId || run.status === "running"),
  );
  try {
    await request<void>("/api/scheduled-tasks/seen", {
      method: "POST",
      body: JSON.stringify({ chatId }),
    });
  } finally {
    void queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.activity() });
  }
}

/** A run started or ended: the chat list and the tasks have changed with it. */
export function refreshAfterScheduledRun(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  void queryClient.invalidateQueries({ queryKey: chatKeys.active() });
  void queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.list() });
  void queryClient.invalidateQueries({
    queryKey: [...scheduledTaskKeys.all(), "runs"],
  });
}
