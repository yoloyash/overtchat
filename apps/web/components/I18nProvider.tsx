"use client";

import {
  Fragment,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { I18nextProvider } from "react-i18next";
import {
  DEFAULT_APP_LANGUAGE,
  parseAppLanguage,
  type AppLanguage,
} from "@overtchat/shared/i18n";
import { LANGUAGE_STORAGE_KEY, applyLanguage, i18n } from "@/lib/i18n";
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

function subscribeToLanguage(onChange: () => void) {
  i18n.on("languageChanged", onChange);
  return () => i18n.off("languageChanged", onChange);
}

const activeLanguage = () => i18n.language;

/**
 * Draws everything inside from scratch when the language changes. Labels made
 * by helpers, or held in a memo cache, would otherwise keep the old language
 * until something else redrew them.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(
    subscribeToLanguage,
    activeLanguage,
    activeLanguage,
  );
  return <Fragment key={language}>{children}</Fragment>;
}
