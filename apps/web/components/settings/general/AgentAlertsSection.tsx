"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/client";
import { playAgentAlertSound } from "@/lib/notifications/sound";
import {
  AGENT_ALERT_BLOCKED,
  requestNotificationAccess,
  useAgentAlertChoices,
} from "@/lib/notifications/useAgentAlertChoices";
import { SettingsRow, SettingsSection } from "../SettingsRows";

/**
 * Per-device alerts: for chat replies that finish in the background, and for
 * the agents an administrator runs.
 */
export function AgentAlertsSection() {
  const { data: session } = authClient.useSession();
  const { sound, setSound, system, systemWanted, setSystem, access } =
    useAgentAlertChoices();
  const [refused, setRefused] = useState<string | null>(null);
  // Turned on here, then taken away in the browser's own settings.
  const problem = refused ?? (systemWanted && !system ? AGENT_ALERT_BLOCKED : null);
  const agents = session?.user?.role === "admin";

  function toggleSound(next: boolean) {
    setSound(next);
    if (!next) return;
    // The switch is the gesture that lets the page play sound.
    void playAgentAlertSound("done");
  }

  async function toggleSystem(next: boolean) {
    setRefused(null);
    if (!next) {
      setSystem(false);
      return;
    }
    const result = access === "granted" ? access : await requestNotificationAccess();
    if (result === "unsupported") {
      setRefused(
        "System notifications need a supported browser over HTTPS, or the desktop app.",
      );
      return;
    }
    if (result !== "granted") {
      // Asked and refused: stop wanting it until the switch is used again.
      setSystem(false);
      setRefused(AGENT_ALERT_BLOCKED);
      return;
    }
    setSystem(true);
  }

  return (
    <SettingsSection
      title="Alerts"
      description={
        agents
          ? "When a chat reply is ready in the background, and when an agent needs you, finishes or fails. Only on this device, and only while OvertChat is open; otherwise your phone is told."
          : "When a chat reply is ready in the background. Only on this device, and only while OvertChat is open."
      }
    >
      <SettingsRow
        title="Play a sound"
        description={
          agents
            ? "A short chime: rising when an agent needs you, falling when it or a reply is done."
            : "A short chime when a reply is done."
        }
        htmlFor="agent-alert-sound"
        align="center"
        controlAlign="end"
        layout="toggle"
      >
        <Switch
          id="agent-alert-sound"
          checked={sound}
          onCheckedChange={toggleSound}
          aria-label="Play a sound"
        />
      </SettingsRow>
      <SettingsRow
        title="System notifications"
        description={
          problem ??
          (agents
            ? "Shown while the window is in the background. In front, agent alerts appear in the corner instead."
            : "Shown while the window is in the background.")
        }
        htmlFor="agent-alert-system"
        align="center"
        controlAlign="end"
        layout="toggle"
      >
        <Switch
          id="agent-alert-system"
          checked={system}
          onCheckedChange={(next) => void toggleSystem(next)}
          aria-label="System notifications"
        />
      </SettingsRow>
    </SettingsSection>
  );
}
