import { useSyncExternalStore } from "react";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_APP_LANGUAGE,
  parseAppLanguage,
  resolveSupportedLocale,
  setLocale,
  type AppLanguage,
} from "@overtchat/shared/i18n";

const KEY = "overtchat.languagePref";

/** Switches the interface to a saved choice; "system" follows the device's language list. */
export function applyLanguage(language: AppLanguage) {
  setLocale(
    resolveSupportedLocale(
      language,
      getLocales().map((locale) => locale.languageTag),
    ),
  );
}

const listeners = new Set<() => void>();
let cached: AppLanguage = parseAppLanguage(SecureStore.getItem(KEY));
// Applied as the bundle loads, so the first screen is already in the right language.
applyLanguage(cached);

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return cached;
}

export function useLanguagePref(): AppLanguage {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setLanguagePref(language: AppLanguage) {
  if (language === cached) return;
  cached = language;
  // The default needs no stored value — a fresh/cleared device resolves to it.
  if (language === DEFAULT_APP_LANGUAGE) {
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  } else {
    SecureStore.setItem(KEY, language);
  }
  applyLanguage(language);
  listeners.forEach((cb) => cb());
}
