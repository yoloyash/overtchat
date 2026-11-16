import {
  apiError,
  scheduledActivitySignature,
  unreadRunChatIds,
  type ScheduledTask,
  type ScheduledTaskActivityResponse,
  type ScheduledTaskActivityRun,
  type ScheduledTaskInput,
  type ScheduledTaskListResponse,
  type ScheduledTaskPatch,
  type ScheduledTaskRun,
} from "@overtchat/shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authFetch, getApiBase } from "@/lib/api";
import { useCapabilities } from "@/lib/queries/capabilities";
import { queryKeys } from "@/lib/queries/keys";

/** How often an open app asks whether a run started or finished. */
const ACTIVITY_POLL_MS = 30_000;
/** While a run is going, so the app learns it finished soon after it does. */
const RUNNING_POLL_MS = 3_000;

async function request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const response = await authFetch(`${getApiBase()}${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw apiError(response.status, body, "Could not complete the request. Please try again.");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Whether the server this app talks to has scheduled tasks. */
export function useScheduledTasksSupported(): boolean {
  return useCapabilities().data?.capabilities.scheduledTasks === true;
}

export function useScheduledTasks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.scheduledTasks(),
    queryFn: () => request<ScheduledTaskListResponse>("/api/scheduled-tasks"),
    enabled,
  });
}

export function useScheduledTaskRuns(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.scheduledTaskRuns(id),
    queryFn: async () =>
      (
        await request<{ runs: ScheduledTaskRun[] }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}/runs`,
        )
      ).runs,
    enabled,
  });
}

/**
 * Runs in progress and finished runs nobody has opened. Asked for only once
 * the person has a task: nothing else could have run.
 */
export function useScheduledTaskActivity() {
  const supported = useScheduledTasksSupported();
  const tasks = useScheduledTasks(supported);
  return useQuery({
    queryKey: queryKeys.scheduledTaskActivity(),
    queryFn: async (): Promise<ScheduledTaskActivityRun[]> =>
      (await request<ScheduledTaskActivityResponse>("/api/scheduled-tasks/activity")).runs,
    enabled: supported && (tasks.data?.tasks.length ?? 0) > 0,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running")
        ? RUNNING_POLL_MS
        : ACTIVITY_POLL_MS,
    retry: false,
  });
}

/**
 * Keeps the open app in step with runs the server starts by its own clock:
 * when a run starts or ends, the chat list, the tasks and their run history
 * are asked for again.
 */
export function useScheduledRunRefresh(): void {
  const client = useQueryClient();
  const { data: runs } = useScheduledTaskActivity();
  const signature = runs ? scheduledActivitySignature(runs) : null;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (previous.current !== null && previous.current !== signature) {
      void client.invalidateQueries({ queryKey: queryKeys.chats() });
      void client.invalidateQueries({ queryKey: queryKeys.scheduledTasks() });
      void client.invalidateQueries({
        queryKey: [...queryKeys.scheduledTasksRoot(), "runs"],
      });
    }
    previous.current = signature;
  }, [client, signature]);
}

function invalidateTasks(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.scheduledTasksRoot() });
}

export function useCreateScheduledTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduledTaskInput) =>
      (
        await request<{ task: ScheduledTask }>("/api/scheduled-tasks", {
          method: "POST",
          body: input,
        })
      ).task,
    onSuccess: () => invalidateTasks(client),
  });
}

export function useUpdateScheduledTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ScheduledTaskPatch }) =>
      (
        await request<{ task: ScheduledTask }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}`,
          { method: "PATCH", body: patch },
        )
      ).task,
    onSuccess: () => invalidateTasks(client),
  });
}

export function useDeleteScheduledTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateTasks(client),
  });
}

export function useRunScheduledTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await request<{ run: ScheduledTaskRun }>(
          `/api/scheduled-tasks/${encodeURIComponent(id)}/run`,
          { method: "POST" },
        )
      ).run,
    onSuccess: () => invalidateTasks(client),
  });
}

/** The owner opened a chat a run wrote: it is no longer new. */
export async function markScheduledRunsSeen(
  client: QueryClient,
  chatId: string,
): Promise<void> {
  await request<void>("/api/scheduled-tasks/seen", {
    method: "POST",
    body: { chatId },
  });
  await invalidateTasks(client);
}

/**
 * Marks a chat's scheduled results as read while it is the chat on screen.
 * `watching` is false when another screen covers it or the app is away.
 */
export function useReadScheduledResults(chatId: string, watching: boolean) {
  const client = useQueryClient();
  const { data: runs } = useScheduledTaskActivity();
  const unread = watching && unreadRunChatIds(runs).has(chatId);
  useEffect(() => {
    if (!unread) return;
    void markScheduledRunsSeen(client, chatId).catch(() => undefined);
  }, [chatId, client, unread]);
}
