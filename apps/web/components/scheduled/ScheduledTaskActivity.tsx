"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { scheduledActivitySignature, unreadRunChatIds } from "@overtchat/shared";
import { usePublicCapabilities } from "@/lib/queries/capabilities";
import {
  markScheduledRunsSeen,
  refreshAfterScheduledRun,
  scheduledTaskListQuery,
  useScheduledTaskActivity,
} from "@/lib/queries/scheduledTasks";
import { chatIdOfPath } from "@/lib/scheduled-tasks/activity";

/** Whether the server this page talks to has scheduled tasks. */
export function useScheduledTasksSupported(): boolean {
  const { data } = usePublicCapabilities();
  return data?.capabilities.scheduledTasks === true;
}

/**
 * Runs in progress and unopened results, for whoever shows them. Asked for
 * only once the person has a task: nothing else could have run.
 */
export function useScheduledTaskRunActivity() {
  const supported = useScheduledTasksSupported();
  const { data: list } = useQuery({
    ...scheduledTaskListQuery,
    enabled: supported,
  });
  return useScheduledTaskActivity(supported && (list?.tasks.length ?? 0) > 0);
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * Keeps an open page in step with runs the server starts by its own clock:
 * a run that starts or ends refreshes the chat list, and a result is marked
 * as seen once its chat is on screen.
 */
export function ScheduledTaskActivity() {
  const queryClient = useQueryClient();
  const { data: runs } = useScheduledTaskRunActivity();
  const pathname = useLocation({ select: (location) => location.pathname });
  const visible = useDocumentVisible();

  const signature = runs ? scheduledActivitySignature(runs) : null;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (previous.current !== null && previous.current !== signature) {
      refreshAfterScheduledRun(queryClient);
    }
    previous.current = signature;
  }, [queryClient, signature]);

  const openChatId = chatIdOfPath(pathname);
  const openIsUnread =
    openChatId !== null && unreadRunChatIds(runs).has(openChatId);
  useEffect(() => {
    if (!openIsUnread || !visible || !openChatId) return;
    void markScheduledRunsSeen(queryClient, openChatId).catch(() => undefined);
  }, [openChatId, openIsUnread, queryClient, visible]);

  return null;
}
