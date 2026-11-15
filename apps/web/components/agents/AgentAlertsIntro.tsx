"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AGENT_ALERT_SOUND_KEY,
  AGENT_ALERT_SYSTEM_KEY,
} from "@/lib/notifications/agentNotification";
import { playAgentAlertSound } from "@/lib/notifications/sound";
import {
  requestNotificationAccess,
  useAgentAlertChoices,
} from "@/lib/notifications/useAgentAlertChoices";
import { useLocalStorage } from "@/lib/useLocalStorage";

/** Set once this device has answered the offer, either way. */
export const AGENT_ALERT_INTRO_KEY = "overtchat:agent-alert-intro";

/** Whether this device has ever set an alert choice, in Settings or here. */
function alertsNeverChosen(): boolean {
  try {
    return (
      localStorage.getItem(AGENT_ALERT_SOUND_KEY) === null &&
      localStorage.getItem(AGENT_ALERT_SYSTEM_KEY) === null
    );
  } catch {
    return false;
  }
}

/**
 * Offers alerts once per device, where an agent is at work. A browser only
 * asks for notification permission from a click, so the offer is the click.
 * The desktop app has alerts on from the start and never shows this.
 */
export function AgentAlertsIntro() {
  const { sound, systemWanted, setSound, setSystem, access } = useAgentAlertChoices();
  const [answered, setAnswered] = useLocalStorage<boolean>(AGENT_ALERT_INTRO_KEY, false);
  const [untouched] = useState(alertsNeverChosen);
  const [blocked, setBlocked] = useState(false);
  if (answered || !untouched || access === "unsupported") return null;
  // Blocked before the offer was ever made: the browser would not ask.
  if (access === "denied" && !blocked) return null;
  if (!blocked && (sound || systemWanted)) return null;

  async function enable() {
    const result = await requestNotificationAccess();
    // A prompt closed without an answer can be asked again.
    if (result === "default") return;
    if (result !== "granted") {
      setBlocked(true);
      return;
    }
    setSystem(true);
    setSound(true);
    setAnswered(true);
    // The click is the gesture that lets the page play sound.
    void playAgentAlertSound("done");
  }

  return (
    <section
      aria-label="Agent alerts"
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm"
    >
      <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-56 text-muted-foreground">
        {blocked
          ? "Your browser is blocking notifications for this site. Allow them there, then turn on Agent alerts in Settings."
          : "Get notified when an agent needs you or finishes."}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setAnswered(true)}>
          {blocked ? "Dismiss" : "Not now"}
        </Button>
        {!blocked && (
          <Button size="sm" onClick={() => void enable()}>
            Enable notifications
          </Button>
        )}
      </div>
    </section>
  );
}
