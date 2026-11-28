"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  parseAppLanguage,
  type AppLanguage,
} from "@overtchat/shared/i18n";
import { useLanguagePreference } from "@/components/I18nProvider";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsChoiceGroup } from "../SettingsChoiceGroup";
import { AccentPicker } from "./AccentPicker";
import { AgentAlertsSection } from "./AgentAlertsSection";
import { Switch } from "@/components/ui/switch";
import {
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
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
import {
  DEFAULT_EXPAND_ACTIVITY,
  EXPAND_ACTIVITY_STORAGE_KEY,
} from "@/lib/chat/activity-expansion";

type ThemeValue = "light" | "dark" | "system";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_stats_for_nerds";

const OPTIONS: Array<{ value: ThemeValue; icon: typeof Sun }> = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

const LANGUAGES: AppLanguage[] = ["system", ...SUPPORTED_LOCALES];

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function GeneralForm() {
  const { t } = useTranslation();
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
  const [expandActivity, setExpandActivity] = useLocalStorage<boolean>(
    EXPAND_ACTIVITY_STORAGE_KEY,
    DEFAULT_EXPAND_ACTIVITY,
  );
  const [fontId, setFontId] = useLocalStorage<FontId>(
    FONT_STORAGE_KEY,
    DEFAULT_FONT_ID,
  );
  const currentFont = mounted ? fontId : DEFAULT_FONT_ID;
  const [language, setLanguage] = useLanguagePreference();
  // Font and language names stay in their own words; only "System" is translated.
  const fontLabel = (id: FontId, label: string) =>
    id === "system" ? t("settings.appearance.font.system") : label;
  const languageLabel = (value: AppLanguage) =>
    value === "system"
      ? t("settings.appearance.language.system")
      : LOCALE_NATIVE_NAMES[value];

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
        title={t("settings.general.title")}
        description={t("settings.general.description")}
      />

      <SettingsSection
        title={t("settings.appearance.title")}
        description={t("settings.appearance.description")}
      >
        <SettingsRow
          title={t("settings.appearance.theme.title")}
          description={t("settings.appearance.theme.description")}
          align="center"
          controlAlign="end"
        >
          <SettingsChoiceGroup
            label={t("settings.appearance.theme.title")}
            value={current}
            onValueChange={setTheme}
            options={OPTIONS.map(({ value, icon: Icon }) => ({
              value,
              label: (
                <>
                  <Icon aria-hidden="true" />
                  <span>{t(`settings.appearance.theme.${value}`)}</span>
                </>
              ),
            }))}
          />
        </SettingsRow>

        <SettingsRow
          title={t("settings.appearance.accent.title")}
          description={t("settings.appearance.accent.description")}
          controlAlign="end"
        >
          <AccentPicker />
        </SettingsRow>

        <SettingsRow
          title={t("settings.appearance.font.title")}
          description={t("settings.appearance.font.description")}
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
                {fontLabel(
                  currentFont,
                  FONT_OPTIONS.find((font) => font.id === currentFont)?.label ?? "",
                )}
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
                  {fontLabel(id, label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          title={t("settings.appearance.language.title")}
          description={t("settings.appearance.language.description")}
          htmlFor="interface-language"
          align="center"
          controlAlign="end"
        >
          <Select
            value={language}
            onValueChange={(next) => setLanguage(parseAppLanguage(next))}
          >
            <SelectTrigger id="interface-language" className="w-full">
              <SelectValue>{languageLabel(language)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  lang={value === "system" ? undefined : value}
                >
                  {languageLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.general.messages.title")}
        description={t("settings.general.messages.description")}
      >
        <SettingsRow
          title={t("settings.general.messages.expandActivity.title")}
          description={t("settings.general.messages.expandActivity.description")}
          htmlFor="expand-activity"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="expand-activity"
            checked={expandActivity}
            onCheckedChange={(next) => setExpandActivity(next)}
            aria-label={t("settings.general.messages.expandActivity.title")}
          />
        </SettingsRow>

        <SettingsRow
          title={t("settings.general.messages.messageStats.title")}
          description={t("settings.general.messages.messageStats.description")}
          htmlFor="message-stats"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="message-stats"
            checked={messageStatsEnabled}
            onCheckedChange={(next) => setMessageStatsEnabled(next)}
            aria-label={t("settings.general.messages.messageStats.toggle")}
          />
        </SettingsRow>

        <SettingsRow
          title={t("settings.general.messages.contextMeter.title")}
          description={t("settings.general.messages.contextMeter.description")}
          htmlFor="context-meter"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="context-meter"
            checked={contextMeterEnabled}
            onCheckedChange={(next) => setContextMeterEnabled(next)}
            aria-label={t("settings.general.messages.contextMeter.toggle")}
          />
        </SettingsRow>

        <SettingsRow
          title={t("settings.general.messages.sessionCost.title")}
          description={t("settings.general.messages.sessionCost.description")}
          htmlFor="session-cost"
          align="center"
          controlAlign="end"
          layout="toggle"
        >
          <Switch
            id="session-cost"
            checked={sessionCostEnabled}
            onCheckedChange={(next) => setSessionCostEnabled(next)}
            aria-label={t("settings.general.messages.sessionCost.toggle")}
          />
        </SettingsRow>
      </SettingsSection>

      <AgentAlertsSection />
    </SettingsPage>
  );
}
