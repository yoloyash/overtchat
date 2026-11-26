export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** The saved choice: follow the device, or one fixed language. */
export type AppLanguage = "system" | SupportedLocale;

export const DEFAULT_LOCALE: SupportedLocale = "en";
export const DEFAULT_APP_LANGUAGE: AppLanguage = "system";

/** Each language in its own words, as language pickers conventionally show it. */
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export function parseAppLanguage(value: unknown): AppLanguage {
  return value === "system" || SUPPORTED_LOCALES.includes(value as SupportedLocale)
    ? (value as AppLanguage)
    : DEFAULT_APP_LANGUAGE;
}

/** Maps one system language tag to a supported locale, or null when we have none. */
function matchSystemLocale(tag: string): SupportedLocale | null {
  const normalized = tag.toLowerCase().replaceAll("_", "-");
  const [base] = normalized.split("-", 1);
  if (base === "en") return "en";
  if (base === "zh") {
    // Traditional Chinese readers get English until a Traditional catalog exists.
    const traditional =
      normalized.includes("-hant") ||
      (!normalized.includes("-hans") && /-(tw|hk|mo)\b/.test(normalized));
    return traditional ? null : "zh-CN";
  }
  return null;
}

/**
 * The language to show: the saved choice, or the first system language we
 * support, in the order the device lists them.
 */
export function resolveSupportedLocale(
  language: AppLanguage,
  systemLocales: readonly string[],
): SupportedLocale {
  if (language !== "system") return language;
  for (const tag of systemLocales) {
    const match = matchSystemLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/**
 * The locale for dates, times and numbers. It is the active language, in the
 * device's own regional form when the device lists that language (so English
 * on a British phone keeps British dates), and never another language: a
 * Chinese interface does not show "Mar 4".
 */
export function resolveFormatLocale(
  active: SupportedLocale,
  systemLocales: readonly string[],
): string {
  const own = systemLocales.find((tag) => matchSystemLocale(tag) === active);
  return own ? own.replaceAll("_", "-") : active;
}
