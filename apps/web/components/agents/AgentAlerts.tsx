"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { AgentSessionStatusIcon } from "@/components/agents/AgentSessionStatus";
import { toast } from "@/components/ui/toast";
import {
  agentAttentionCounts,
  type AgentSessionState,
} from "@/lib/agents/attention";
import { agentSessionIdForPath } from "@/lib/agents/sidebarMode";
import { desktopBridge } from "@/lib/desktop";
import {
  AGENT_ALERT_SOUND_KEY,
  AGENT_ALERT_SYSTEM_KEY,
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

const NOTIFICATION_STATES: Record<AgentNotification["reason"], AgentSessionState> = {
  approval: "approval",
  question: "question",
  completed: "unread",
  failed: "failed",
};

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
        if (sound) {
          playAgentAlertSound(
            agentNotificationNeedsInput(notification.reason) ? "input" : "done",
          );
        }
        if (visible && document.hasFocus()) {
          toast.notice({
            title: notification.title,
            description: notification.body,
            icon: (
              <AgentSessionStatusIcon
                state={NOTIFICATION_STATES[notification.reason]}
                className="mt-0.5"
              />
            ),
            action: { label: "Open", onClick: open },
          });
          return;
        }
        if (system) showSystemNotification(notification, open);
      }),
    [navigate],
  );
  return null;
}

function showSystemNotification(
  notification: AgentNotification,
  open: () => void,
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
      silent: true,
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
