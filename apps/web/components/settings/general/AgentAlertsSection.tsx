"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth/client";
import { playAgentAlertSound } from "@/lib/notifications/sound";
import {
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
  const { t } = useTranslation();
  const [refused, setRefused] = useState<"unsupported" | "blocked" | null>(null);
  // Turned on here, then taken away in the browser's own settings.
  const problem = refused ?? (systemWanted && !system ? "blocked" : null);
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
      setRefused("unsupported");
      return;
    }
    if (result !== "granted") {
      // Asked and refused: stop wanting it until the switch is used again.
      setSystem(false);
      setRefused("blocked");
      return;
    }
    setSystem(true);
  }

  return (
    <SettingsSection
      title={t("settings.alerts.title")}
      description={
        agents
          ? t("settings.alerts.descriptionWithAgents")
          : t("settings.alerts.description")
      }
    >
      <SettingsRow
        title={t("settings.alerts.sound.title")}
        description={
          agents
            ? t("settings.alerts.sound.descriptionWithAgents")
            : t("settings.alerts.sound.description")
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
          aria-label={t("settings.alerts.sound.title")}
        />
      </SettingsRow>
      <SettingsRow
        title={t("settings.alerts.system.title")}
        description={
          problem
            ? t(`settings.alerts.system.${problem}`)
            : agents
              ? t("settings.alerts.system.descriptionWithAgents")
              : t("settings.alerts.system.description")
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
          aria-label={t("settings.alerts.system.title")}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
