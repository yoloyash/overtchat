import { useLocales } from "expo-localization";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import {
  i18n,
  resolveFormatLocale,
  type SupportedLocale,
} from "@overtchat/shared/i18n";
import { applyLanguage, useLanguagePref } from "@/lib/languagePref";

/**
 * Makes translations available to every screen. While the choice is "System",
 * a language change in the device settings is followed without a restart.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useLanguagePref();
  const systemLanguage = useLocales()[0]?.languageTag;
  useEffect(() => {
    applyLanguage(language);
  }, [language, systemLanguage]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** The locale for dates and numbers; changes with the language. */
export function useFormatLocale(): string {
  // Reading the language here is what ties the caller to a language change.
  const { i18n: active } = useTranslation();
  const system = useLocales();
  return resolveFormatLocale(
    active.language as SupportedLocale,
    system.map((locale) => locale.languageTag),
  );
}
