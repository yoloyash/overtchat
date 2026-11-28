import { createInstance } from "i18next";
import type { SourceCatalog } from "./catalog";
import { DEFAULT_LOCALE, type SupportedLocale } from "./locales";
import { en } from "./resources/en/index";
import { zhCN } from "./resources/zh-CN/index";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: SourceCatalog };
  }
}

export const LOCALE_RESOURCES: Record<SupportedLocale, object> = {
  en,
  "zh-CN": zhCN,
};

/**
 * The one translation instance. It starts in English and only a client changes
 * its language, so the server, and everything it writes for models, stays
 * English. Components read it with `useTranslation()`; code outside React
 * calls `i18n.t()` when the text is needed, never at module load.
 */
export const i18n = createInstance();

void i18n.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: Object.keys(LOCALE_RESOURCES),
  resources: Object.fromEntries(
    Object.entries(LOCALE_RESOURCES).map(([locale, translation]) => [locale, { translation }]),
  ),
  // Resources are bundled, so init and language changes finish synchronously.
  initAsync: false,
  // React escapes what it renders; escaping here would double it.
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Switches the interface language. A no-op when it is already active. */
export function setLocale(locale: SupportedLocale): void {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
}
