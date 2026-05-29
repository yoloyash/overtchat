/**
 * Per-device interface-font registry. Single source of truth for the font
 * picker — consumed by `app/layout.tsx` (the no-FOUC inline script) and the
 * settings picker in `app/(app)/settings/general/GeneralForm.tsx`.
 *
 * The picked font applies to all UI and content text. Only the brand wordmark
 * (Fraunces, via --font-brand) and code (Geist Mono) are fixed. The choice lives
 * in localStorage — no DB, no migration, per-browser.
 *
 * NOTE: the actual `next/font/google` calls must stay top-level in `layout.tsx`;
 * this module only owns the ids, labels, storage key, and the value written to
 * `--app-font-sans`. Keep `cssValue`'s `var(--font-*)` names aligned with the
 * `variable` strings in `layout.tsx`.
 */

export const FONT_STORAGE_KEY = "overtchat_font_sans";

export const DEFAULT_FONT_ID = "plus-jakarta" as const;

const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export type FontId =
  | "system"
  | "inter"
  | "roboto"
  | "plus-jakarta"
  | "geist"
  | "ibm-plex-sans";

export interface FontOption {
  id: FontId;
  label: string;
  /** Value written to `--app-font-sans`. `null` for the default (CSS fallback). */
  cssValue: string | null;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "system", label: "System", cssValue: SYSTEM_STACK },
  { id: "inter", label: "Inter", cssValue: "var(--font-inter)" },
  { id: "roboto", label: "Roboto", cssValue: "var(--font-roboto)" },
  { id: "plus-jakarta", label: "Plus Jakarta Sans", cssValue: null }, // default → CSS fallback
  { id: "geist", label: "Geist", cssValue: "var(--font-geist)" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", cssValue: "var(--font-ibm-plex-sans)" },
];

/** Non-null entries only, keyed by id — consumed by the inline no-FOUC script. */
export const fontCssValueById: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.filter((f) => f.cssValue !== null).map((f) => [f.id, f.cssValue!]),
);
