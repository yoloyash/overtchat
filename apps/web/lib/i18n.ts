import {
  DEFAULT_APP_LANGUAGE,
  i18n,
  parseAppLanguage,
  resolveSupportedLocale,
  setLocale,
  type AppLanguage,
  type SupportedLocale,
} from "@overtchat/shared/i18n";

/** Per-browser language choice, kept with the other device preferences. */
export const LANGUAGE_STORAGE_KEY = "overtchat_language";

function systemLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function storedLanguage(): AppLanguage {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw === null ? DEFAULT_APP_LANGUAGE : parseAppLanguage(JSON.parse(raw));
  } catch {
    return DEFAULT_APP_LANGUAGE;
  }
}

/** Switches the interface to a saved choice and tells the browser its language. */
export function applyLanguage(language: AppLanguage): SupportedLocale {
  const locale = resolveSupportedLocale(language, systemLocales());
  setLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return locale;
}

// The UI is client-only, so applying the saved choice as the bundle loads
// means the first paint is already in the right language.
if (typeof window !== "undefined") applyLanguage(storedLanguage());

export { i18n };
