"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsChoiceGroup } from "../_components/SettingsChoiceGroup";
import { Switch } from "@/components/ui/switch";
import {
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  FONT_STORAGE_KEY,
  type FontId,
} from "@/lib/fonts";
import {
  CONTEXT_METER_STORAGE_KEY,
  DEFAULT_CONTEXT_METER_ENABLED,
} from "@/lib/chat/context-meter";
import {
  DEFAULT_SESSION_COST_ENABLED,
  SESSION_COST_STORAGE_KEY,
} from "@/lib/chat/session-cost";

type ThemeValue = "light" | "dark" | "system";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_stats_for_nerds";

const OPTIONS: Array<{ value: ThemeValue; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function GeneralForm() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  // Keep the radio group controlled during hydration so it follows the saved theme.
  const current = (mounted ? (theme ?? "system") : "system") as ThemeValue;
  const [messageStatsEnabled, setMessageStatsEnabled] =
    useLocalStorage<boolean>(MESSAGE_STATS_STORAGE_KEY, false);
  const [contextMeterEnabled, setContextMeterEnabled] =
    useLocalStorage<boolean>(
      CONTEXT_METER_STORAGE_KEY,
      DEFAULT_CONTEXT_METER_ENABLED,
    );
  const [sessionCostEnabled, setSessionCostEnabled] = useLocalStorage<boolean>(
    SESSION_COST_STORAGE_KEY,
    DEFAULT_SESSION_COST_ENABLED,
  );
  const [fontId, setFontId] = useLocalStorage<FontId>(
    FONT_STORAGE_KEY,
    DEFAULT_FONT_ID,
  );
  const currentFont = mounted ? fontId : DEFAULT_FONT_ID;

  function selectFont(next: FontId) {
    setFontId(next);
    // The blocking script only runs on page load; apply the change live too.
    const opt = FONT_OPTIONS.find((f) => f.id === next);
    const root = document.documentElement;
    if (!opt || opt.cssValue === null)
      root.style.removeProperty("--app-font-sans");
    else root.style.setProperty("--app-font-sans", opt.cssValue);
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title="General"
        description="Preferences saved for this browser."
      />

      <SettingsSection
        title="Appearance"
        description="Choose how OvertChat looks and reads."
      >
        <SettingsRow
          title="Theme"
          description="Use a fixed theme or follow the system setting."
          align="center"
          controlAlign="end"
        >
          <SettingsChoiceGroup
            label="Theme"
            value={current}
            onValueChange={setTheme}
            options={OPTIONS.map(({ value, label, icon: Icon }) => ({
              value,
              label: (
                <>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </>
              ),
            }))}
          />
        </SettingsRow>

        <SettingsRow
          title="Interface font"
          description="Choose the font used throughout the app."
          htmlFor="interface-font"
          align="center"
          controlAlign="end"
        >
          <Select
            value={currentFont}
            onValueChange={(next) => selectFont(next as FontId)}
          >
            <SelectTrigger id="interface-font" className="w-full">
              <SelectValue>
                {FONT_OPTIONS.find((font) => font.id === currentFont)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map(({ id, label, cssValue }) => (
                <SelectItem
                  key={id}
                  value={id}
                  style={{
                    fontFamily: cssValue ?? "var(--font-plus-jakarta-sans)",
                  }}
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Messages"
        description="Choose which details appear in your conversations."
      >
        <SettingsRow
          title="Message stats"
          description="Show token counts and speed stats on assistant messages."
          htmlFor="message-stats"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="message-stats"
            checked={messageStatsEnabled}
            onCheckedChange={(next) => setMessageStatsEnabled(next)}
            aria-label="Show message stats"
          />
        </SettingsRow>

        <SettingsRow
          title="Context meter"
          description="Show context-window usage in the chat header."
          htmlFor="context-meter"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="context-meter"
            checked={contextMeterEnabled}
            onCheckedChange={(next) => setContextMeterEnabled(next)}
            aria-label="Show context meter"
          />
        </SettingsRow>

        <SettingsRow
          title="Session cost"
          description="Show session cost in the chat header."
          htmlFor="session-cost"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="session-cost"
            checked={sessionCostEnabled}
            onCheckedChange={(next) => setSessionCostEnabled(next)}
            aria-label="Show session cost"
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
