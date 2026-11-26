import { app } from "electron";
import {
  SUPPORTED_LOCALES,
  resolveSupportedLocale,
  setLocale,
  type SupportedLocale,
} from "@overtchat/shared/i18n";
import { getLanguage, setLanguage } from "./settings";

function isSupported(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

/**
 * Menus and dialogs are drawn by this process, which cannot see the choice
 * the interface keeps in browser storage. It starts from the language the
 * interface last reported, or the system's before the first report.
 */
export function applyStoredLanguage(): void {
  const saved = getLanguage();
  setLocale(
    isSupported(saved)
      ? saved
      : resolveSupportedLocale("system", app.getPreferredSystemLanguages()),
  );
}

/** Follows the interface's language. Returns whether it changed. */
export function followInterfaceLanguage(value: unknown): boolean {
  if (!isSupported(value) || value === getLanguage()) return false;
  setLanguage(value);
  setLocale(value);
  return true;
}
