"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { AgentSessionStatusIcon } from "@/components/agents/AgentSessionStatus";
import { toast } from "@/components/ui/toast";
import { agentAttentionCounts } from "@/lib/agents/attention";
import { agentSessionIdForPath } from "@/lib/agents/sidebarMode";
import { desktopBridge } from "@/lib/desktop";
import {
  AGENT_ALERT_SOUND_KEY,
  AGENT_ALERT_SYSTEM_KEY,
  agentNotificationHeading,
  agentNotificationNeedsInput,
  type AgentNotification,
} from "@/lib/notifications/agentNotification";
import { subscribeAgentStream } from "@/lib/notifications/agentStream";
import { showAgentAttentionBadge } from "@/lib/notifications/favicon";
import {
  playAgentAlertSound,
  unlockAgentAlertSound,
} from "@/lib/notifications/sound";
import { useAgentPresence } from "@/lib/notifications/useAgentPresence";
import {
  useAgentConnectionSessionDirectory,
  useAgentConnections,
} from "@/lib/queries/agentConnections";
import { useLocalStorage } from "@/lib/useLocalStorage";

/** Alerts already shown this page load; a replayed stream shows none twice. */
const seen = new Set<string>();

/** One toast per session: a newer alert takes the place of the one before it. */
const alertToastId = (sessionId: string) => `agent-alert:${sessionId}`;

/**
 * Keeps the server told where this client is, counts what needs the owner on
 * the icon, and shows the alerts the server sends this client: a toast while
 * the window is in front, a system notification while it is not.
 */
export function AgentAlerts({
  connections,
}: {
  connections: AgentConnectionListItem[];
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const viewing = agentSessionIdForPath(pathname);
  const [sound] = useLocalStorage<boolean>(AGENT_ALERT_SOUND_KEY, false);
  const [system] = useLocalStorage<boolean>(AGENT_ALERT_SYSTEM_KEY, false);
  useAgentPresence(viewing, sound || system);

  const counts = useMemo(() => agentAttentionCounts(connections), [connections]);
  useEffect(() => {
    showAgentAttentionBadge(counts.needsYou + counts.unread);
  }, [counts]);
  // Signing out or losing admin rights takes the count off the icon too.
  useEffect(() => () => showAgentAttentionBadge(0), []);

  useEffect(() => {
    if (!sound) return;
    document.addEventListener("pointerdown", unlockAgentAlertSound);
    document.addEventListener("keydown", unlockAgentAlertSound);
    return () => {
      document.removeEventListener("pointerdown", unlockAgentAlertSound);
      document.removeEventListener("keydown", unlockAgentAlertSound);
    };
  }, [sound]);

  // An alert has done its work once its session is on screen.
  useEffect(() => {
    if (viewing) toast.dismiss(alertToastId(viewing));
  }, [viewing]);

  // Alerts arrive outside render; read the latest choices when they do.
  const current = useRef({ viewing, sound, system });
  useEffect(() => {
    current.current = { viewing, sound, system };
  }, [viewing, sound, system]);
  useEffect(
    () =>
      subscribeAgentStream((event) => {
        if (event.type !== "notification") return;
        const { viewing, sound, system } = current.current;
        if (!sound && !system) return;
        const { notification } = event;
        if (seen.has(notification.eventId)) return;
        seen.add(notification.eventId);
        if (seen.size > 200) seen.delete(seen.values().next().value!);
        const visible = document.visibilityState === "visible";
        if (visible && viewing === notification.sessionId) return;
        const open = () =>
          void navigate({
            to: "/agents/$id",
            params: { id: notification.sessionId },
          });
        const chimed = sound
          ? playAgentAlertSound(
              agentNotificationNeedsInput(notification.reason) ? "input" : "done",
            )
          : Promise.resolve(false);
        if (visible && document.hasFocus()) {
          const { label, session } = agentNotificationHeading(notification);
          toast.notice({
            id: alertToastId(notification.sessionId),
            title: label,
            description: (
              <>
                {session && (
                  <span className="block truncate text-foreground/80">
                    {session}
                  </span>
                )}
                <span className="line-clamp-2">{notification.body}</span>
              </>
            ),
            icon: <AlertIcon reason={notification.reason} />,
            action: { label: "Open", onClick: open },
          });
          return;
        }
        if (!system) return;
        // The system's own sound stands in for a chime that could not play.
        void chimed.then((played) =>
          showSystemNotification(notification, open, !sound || played),
        );
      }),
    [navigate],
  );
  return null;
}

/** The sidebar's marks at a toast's size; a finished turn gets a tick, not a dot. */
function AlertIcon({ reason }: { reason: AgentNotification["reason"] }) {
  if (reason === "completed") {
    return (
      <CircleCheck
        aria-hidden="true"
        className="size-4 text-green-600 dark:text-green-500"
      />
    );
  }
  return <AgentSessionStatusIcon state={reason} className="size-4" />;
}

function showSystemNotification(
  notification: AgentNotification,
  open: () => void,
  silent: boolean,
): void {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  try {
    const shown = new Notification(notification.title, {
      body: notification.body,
      // A newer alert for the same session replaces the one before it.
      tag: `agent:${notification.sessionId}`,
      silent,
    });
    shown.addEventListener("click", () => {
      shown.close();
      window.focus();
      void desktopBridge()?.revealWindow?.().catch(() => undefined);
      open();
    });
  } catch {
    // Some browsers expose Notification but refuse to show one.
  }
}

/**
 * The page's live agent state, mounted once for admins: the session directory
 * stream and the alerts it carries. The sidebar renders twice on phones (a
 * panel and a drawer), so neither can own these.
 */
export function AgentLiveState() {
  const { data: connections = [] } = useAgentConnections();
  useAgentConnectionSessionDirectory(connections);
  return <AgentAlerts connections={connections} />;
}
