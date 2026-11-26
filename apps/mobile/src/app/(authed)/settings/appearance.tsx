import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type AppLanguage,
} from "@overtchat/shared/i18n";
import {
  SettingsPage,
  Section,
  Choice,
} from "@/components/settings/SettingsUI";
import { useThemePref, setThemePref } from "@/lib/appearance";
import { useFontPref, setFontPref } from "@/lib/fontPref";
import { FONT_OPTIONS } from "@/lib/fonts";
import { setLanguagePref, useLanguagePref } from "@/lib/languagePref";
import { AccentPicker } from "@/components/ui/AccentPicker";

const LANGUAGES: AppLanguage[] = ["system", ...SUPPORTED_LOCALES];

export default function Appearance() {
  const { t } = useTranslation();
  const theme = useThemePref();
  const font = useFontPref();
  const language = useLanguagePref();
  return (
    <SettingsPage title={t("settings.appearance.title")}>
      <Section
        title={t("settings.appearance.display.title")}
        description={t("settings.appearance.display.description")}
      >
        <Choice
          title={t("settings.appearance.theme.title")}
          value={theme}
          onChange={setThemePref}
          options={[
            { value: "system", label: t("settings.appearance.theme.system") },
            { value: "light", label: t("settings.appearance.theme.light") },
            { value: "dark", label: t("settings.appearance.theme.dark") },
          ]}
        />
        <Choice
          title={t("settings.appearance.font.title")}
          value={font}
          onChange={setFontPref}
          options={FONT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        />
        <Choice
          title={t("settings.appearance.language.title")}
          value={language}
          onChange={setLanguagePref}
          options={LANGUAGES.map((value) => ({
            value,
            label:
              value === "system"
                ? t("settings.appearance.language.system")
                : LOCALE_NATIVE_NAMES[value],
          }))}
        />
      </Section>
      <Section title={t("settings.appearance.accent.title")}>
        <View style={{ padding: 14 }}>
          <AccentPicker />
        </View>
      </Section>
    </SettingsPage>
  );
}
