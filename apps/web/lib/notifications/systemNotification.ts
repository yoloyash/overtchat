"use client";

import { desktopBridge } from "@/lib/desktop";

/** The system notification each subject has up, if any. */
const shown = new Map<string, Notification>();

/**
 * Hands a notification to the system and says whether it could. A newer one
 * for the same key replaces the one before it. A click brings the window to
 * the front before `onOpen` runs.
 */
export function showSystemNotification({
  key,
  title,
  body,
  silent,
  onOpen,
}: {
  key: string;
  title: string;
  body?: string;
  silent: boolean;
  onOpen: () => void;
}): boolean {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  try {
    const notification = new Notification(title, { body, tag: key, silent });
    shown.set(key, notification);
    notification.addEventListener("close", () => {
      if (shown.get(key) === notification) shown.delete(key);
    });
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
      void desktopBridge()?.revealWindow?.().catch(() => undefined);
      onOpen();
    });
    return true;
  } catch {
    // Some browsers expose Notification but refuse to show one.
    return false;
  }
}

/** Takes down a notification whose subject is now on screen. */
export function closeSystemNotification(key: string): void {
  shown.get(key)?.close();
  shown.delete(key);
}
