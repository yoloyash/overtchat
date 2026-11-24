"use client";

import { useSyncExternalStore } from "react";
import { desktopBridge } from "@/lib/desktop";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  AGENT_ALERT_SOUND_KEY,
  AGENT_ALERT_SYSTEM_KEY,
} from "./agentNotification";

/** Whether this page may show system notifications; `unsupported` when it never can. */
export type NotificationAccess = NotificationPermission | "unsupported";

/** What to do about a browser that will not let this site notify. */
export const AGENT_ALERT_BLOCKED =
  "Allow notifications for this site in your browser or system settings, then turn this on again.";

const ACCESS_EVENT = "overtchat:notification-access";

function notificationAccess(): NotificationAccess {
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    return "unsupported";
  }
  return Notification.permission;
}

// A browser's site settings change it without telling the page; coming back
// to the page is when a change made there matters.
function subscribe(callback: () => void): () => void {
  window.addEventListener(ACCESS_EVENT, callback);
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener(ACCESS_EVENT, callback);
    window.removeEventListener("focus", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}

export function useNotificationAccess(): NotificationAccess {
  return useSyncExternalStore(
    subscribe,
    notificationAccess,
    (): NotificationAccess => "unsupported",
  );
}

/** Asks the browser, which only shows its prompt from a click or key press. */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  if (notificationAccess() === "unsupported") return "unsupported";
  const result = await Notification.requestPermission().catch(
    () => "denied" as const,
  );
  window.dispatchEvent(new Event(ACCESS_EVENT));
  return result;
}

/**
 * This device's alert choices. They start on in the desktop app, which may
 * always notify, and off in a browser, which has to ask first.
 */
export function useAgentAlertChoices() {
  const initial = desktopBridge() !== undefined;
  const [sound, setSound] = useLocalStorage<boolean>(AGENT_ALERT_SOUND_KEY, initial);
  const [systemWanted, setSystem] = useLocalStorage<boolean>(
    AGENT_ALERT_SYSTEM_KEY,
    initial,
  );
  const access = useNotificationAccess();
  return {
    sound,
    setSound,
    /** System notifications are wanted and the browser still allows them. */
    system: systemWanted && access === "granted",
    systemWanted,
    setSystem,
    access,
  };
}
