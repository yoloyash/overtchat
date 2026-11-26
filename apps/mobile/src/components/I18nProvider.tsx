import { useLocales } from "expo-localization";
import {
  Fragment,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
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
