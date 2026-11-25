"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  scheduledActivitySignature,
  unreadRunChatIds,
  type ScheduledTaskActivityRun,
} from "@overtchat/shared";
import { toast } from "@/components/ui/toast";
import {
  playAgentAlertSound,
  useAgentAlertSoundUnlock,
} from "@/lib/notifications/sound";
import {
  closeSystemNotification,
  showSystemNotification,
} from "@/lib/notifications/systemNotification";
import { useAgentAlertChoices } from "@/lib/notifications/useAgentAlertChoices";
import { usePublicCapabilities } from "@/lib/queries/capabilities";
import {
  markScheduledRunsSeen,
  refreshAfterScheduledRun,
  scheduledTaskListQuery,
  useScheduledTaskActivity,
} from "@/lib/queries/scheduledTasks";
import {
  chatIdOfPath,
  endedRunIds,
  runsEndedSince,
} from "@/lib/scheduled-tasks/activity";

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
  // A hidden page goes on asking only when it would say that a run ended.
  const { sound, system } = useAgentAlertChoices();
  return useScheduledTaskActivity(
    supported && (list?.tasks.length ?? 0) > 0,
    sound || system,
  );
}

/** One alert per run across this browser's tabs: the first to see it tells. */
const ALERTED_KEY = "overtchat:scheduled-run-alerts";

function claimRunAlert(runId: string): boolean {
  try {
    const told = JSON.parse(localStorage.getItem(ALERTED_KEY) ?? "[]") as string[];
    if (told.includes(runId)) return false;
    localStorage.setItem(ALERTED_KEY, JSON.stringify([...told, runId].slice(-50)));
  } catch {
    // Without storage every tab tells; better twice than not at all.
  }
  return true;
}

const runToastId = (chatId: string) => `scheduled-run:${chatId}`;
// The same key a reply's own notification uses, so one stands for the chat.
const runNotificationKey = (chatId: string) => `chat:${chatId}`;

/**
 * Says when a scheduled run ended, as the device chose for alerts: a toast
 * while the window is in front, the chime and a system notification while
 * it is not. Nobody was watching the run, so the page is the one to tell,
 * unless what is on screen already shows it.
 */
function useScheduledRunAlerts(
  runs: ScheduledTaskActivityRun[] | undefined,
  pathname: string,
) {
  const { t } = useTranslation();
  const openChatId = chatIdOfPath(pathname);
  // The Scheduled page shows a run ending in its own list.
  const watching = pathname === "/scheduled";
  const navigate = useNavigate();
  const { sound, system } = useAgentAlertChoices();
  useAgentAlertSoundUnlock(sound);

  // An alert has done its work once its chat is on screen.
  useEffect(() => {
    if (!openChatId) return;
    toast.dismiss(runToastId(openChatId));
    closeSystemNotification(runNotificationKey(openChatId));
  }, [openChatId]);

  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!runs) return;
    const ended = runsEndedSince(known.current, runs);
    known.current = endedRunIds(runs);
    if (!sound && !system) return;
    for (const run of ended) {
      const chatId = run.chatId;
      if (!chatId) continue;
      const visible = document.visibilityState === "visible";
      if (visible && (watching || openChatId === chatId)) continue;
      if (!claimRunAlert(run.runId)) continue;
      const failed = run.status === "error";
      const title = failed
        ? t("scheduled.alerts.failed")
        : t("scheduled.alerts.finished");
      const open = () => void navigate({ to: "/chat/$id", params: { id: chatId } });
      const showToast = () =>
        toast.notice({
          id: runToastId(chatId),
          title,
          description: run.taskName,
          icon: <CalendarClock className="size-4" />,
          action: { label: t("scheduled.alerts.open"), onClick: open },
        });
      if (visible && document.hasFocus()) {
        showToast();
        continue;
      }
      const chimed = sound ? playAgentAlertSound("done") : Promise.resolve(false);
      if (!system) {
        if (visible) showToast();
        continue;
      }
      // The system's own sound stands in for a chime that could not play.
      void chimed.then((played) => {
        const shown = showSystemNotification({
          key: runNotificationKey(chatId),
          title,
          body: run.taskName,
          silent: !sound || played,
          onOpen: open,
        });
        if (!shown && visible) showToast();
      });
    }
  }, [navigate, openChatId, runs, sound, system, t, watching]);
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
  useScheduledRunAlerts(runs, pathname);
  const openIsUnread =
    openChatId !== null && unreadRunChatIds(runs).has(openChatId);
  useEffect(() => {
    if (!openIsUnread || !visible || !openChatId) return;
    void markScheduledRunsSeen(queryClient, openChatId).catch(() => undefined);
  }, [openChatId, openIsUnread, queryClient, visible]);

  return null;
}
