import {
  DEFAULT_APP_LANGUAGE,
  i18n,
  parseAppLanguage,
  resolveFormatLocale,
  resolveSupportedLocale,
  setLocale,
  type AppLanguage,
  type SupportedLocale,
} from "@overtchat/shared/i18n";

/** Per-browser language choice, kept with the other device preferences. */
export const LANGUAGE_STORAGE_KEY = "overtchat_language";

export function systemLocales(): readonly string[] {
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

/**
 * The locale for dates and numbers shown to the person: the active language,
 * in the browser's regional form when it lists one. In a component, use
 * `useFormatLocale()` so the text follows a language change.
 */
export function formatLocale(): string {
  return resolveFormatLocale(i18n.language as SupportedLocale, systemLocales());
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
