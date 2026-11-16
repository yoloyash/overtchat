"use client";

import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { agentSessionIdForPath } from "@/lib/agents/sidebarMode";
import { chatPresenceKey } from "@/lib/notifications/agentNotification";
import { unlockAgentAlertSound } from "@/lib/notifications/sound";
import { useAgentAlertChoices } from "@/lib/notifications/useAgentAlertChoices";
import { useAgentPresence } from "@/lib/notifications/useAgentPresence";

/** The chat a path shows, as the server's presence names it. */
function chatForPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return chatPresenceKey(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * Keeps the server told where this client is and what it shows, so alerts
 * and pushes go where the person is, and readies the chime on devices that
 * want it. Mounted once for every signed-in user.
 */
export function AlertsPresence() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { sound, system } = useAgentAlertChoices();
  useAgentPresence(
    agentSessionIdForPath(pathname) ?? chatForPath(pathname),
    sound || system,
  );

  // A browser starts a page's audio only from a click or a key press.
  useEffect(() => {
    if (!sound) return;
    document.addEventListener("pointerdown", unlockAgentAlertSound);
    document.addEventListener("keydown", unlockAgentAlertSound);
    return () => {
      document.removeEventListener("pointerdown", unlockAgentAlertSound);
      document.removeEventListener("keydown", unlockAgentAlertSound);
    };
  }, [sound]);
  return null;
}
