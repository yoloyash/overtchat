"use client";

import { useEffect, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import {
  DEFAULT_APP_LANGUAGE,
  parseAppLanguage,
  resolveFormatLocale,
  type AppLanguage,
  type SupportedLocale,
} from "@overtchat/shared/i18n";
import { LANGUAGE_STORAGE_KEY, applyLanguage, i18n, systemLocales } from "@/lib/i18n";
import { useLocalStorage } from "@/lib/useLocalStorage";

/** The saved language choice, and a setter that applies it everywhere at once. */
export function useLanguagePreference(): [AppLanguage, (next: AppLanguage) => void] {
  const [stored, setStored] = useLocalStorage<AppLanguage>(
    LANGUAGE_STORAGE_KEY,
    DEFAULT_APP_LANGUAGE,
  );
  return [parseAppLanguage(stored), setStored];
}

/**
 * Makes translations available to the UI and keeps the active language in
 * step with the saved choice, including when another tab changes it or the
 * system language changes while following it.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language] = useLanguagePreference();
  useEffect(() => {
    applyLanguage(language);
    if (language !== "system") return;
    const follow = () => applyLanguage("system");
    window.addEventListener("languagechange", follow);
    return () => window.removeEventListener("languagechange", follow);
  }, [language]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** The locale for dates and numbers; changes with the language. */
export function useFormatLocale(): string {
  // Reading the language here is what ties the caller to a language change.
  const { i18n: active } = useTranslation();
  return resolveFormatLocale(active.language as SupportedLocale, systemLocales());
}
