"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/client";
import {
  AGENT_ALERT_SOUND_KEY,
  AGENT_ALERT_SYSTEM_KEY,
} from "@/lib/notifications/agentNotification";
import {
  playAgentAlertSound,
  unlockAgentAlertSound,
} from "@/lib/notifications/sound";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { SettingsRow, SettingsSection } from "../SettingsRows";

/** Per-device alerts for the agents an administrator runs. */
export function AgentAlertsSection() {
  const { data: session } = authClient.useSession();
  const [sound, setSound] = useLocalStorage<boolean>(AGENT_ALERT_SOUND_KEY, false);
  const [system, setSystem] = useLocalStorage<boolean>(AGENT_ALERT_SYSTEM_KEY, false);
  const [problem, setProblem] = useState<string | null>(null);
  if (session?.user?.role !== "admin") return null;

  function toggleSound(next: boolean) {
    setSound(next);
    if (!next) return;
    // The switch is the gesture that lets the page play sound.
    unlockAgentAlertSound();
    playAgentAlertSound("done");
  }

  async function toggleSystem(next: boolean) {
    setProblem(null);
    if (!next) {
      setSystem(false);
      return;
    }
    if (typeof Notification === "undefined" || !window.isSecureContext) {
      setProblem(
        "System notifications need a supported browser over HTTPS, or the desktop app.",
      );
      return;
    }
    const permission = await Notification.requestPermission().catch(
      () => "denied" as const,
    );
    if (permission !== "granted") {
      setProblem(
        "Allow notifications for this site in your browser or system settings, then turn this on again.",
      );
      return;
    }
    setSystem(true);
  }

  return (
    <SettingsSection
      title="Agent alerts"
      description="When an agent needs you, finishes or fails. Only on this device, and only while OvertChat is open; otherwise your phone is told."
    >
      <SettingsRow
        title="Play a sound"
        description="A short chime: rising when an agent needs you, falling when it is done."
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
          "Shown while the window is in the background. In front, alerts appear in the corner instead."
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
