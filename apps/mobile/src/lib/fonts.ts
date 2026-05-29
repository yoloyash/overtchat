/**
 * Per-device interface-font registry. Single source of truth for the mobile font
 * picker — consumed by `lib/theme.ts` (resolves the active sans) and the settings
 * picker in `app/(authed)/settings.tsx`.
 *
 * Only the body/UI sans is swappable. Headings (Fraunces) and code (Geist Mono)
 * are fixed — those keys stay on `mobileFonts` and are spread in by `useTheme()`.
 * The choice lives in expo-secure-store (see `lib/fontPref.ts`) — no DB, no
 * migration, per-device.
 *
 * RN doesn't synthesise weights: each weight is its own registered family, so the
 * keys below MUST match the `useFonts({...})` registration in `app/_layout.tsx`.
 */

export type FontId = "inter" | "roboto" | "plus-jakarta" | "geist" | "ibm-plex-sans";

export const DEFAULT_FONT_ID: FontId = "plus-jakarta";

/** The three swappable sans slots, per family. Keys match `_layout.tsx` useFonts(). */
interface SansTriple {
  sansRegular: string;
  sansMedium: string;
  sansSemiBold: string;
}

export const FONT_SANS: Record<FontId, SansTriple> = {
  "plus-jakarta": {
    sansRegular: "PlusJakartaSans_400Regular",
    sansMedium: "PlusJakartaSans_500Medium",
    sansSemiBold: "PlusJakartaSans_600SemiBold",
  },
  inter: {
    sansRegular: "Inter_400Regular",
    sansMedium: "Inter_500Medium",
    sansSemiBold: "Inter_600SemiBold",
  },
  roboto: {
    sansRegular: "Roboto_400Regular",
    sansMedium: "Roboto_500Medium",
    sansSemiBold: "Roboto_600SemiBold",
  },
  geist: {
    sansRegular: "Geist_400Regular",
    sansMedium: "Geist_500Medium",
    sansSemiBold: "Geist_600SemiBold",
  },
  "ibm-plex-sans": {
    sansRegular: "IBMPlexSans_400Regular",
    sansMedium: "IBMPlexSans_500Medium",
    sansSemiBold: "IBMPlexSans_600SemiBold",
  },
};

export const FONT_OPTIONS: { id: FontId; label: string }[] = [
  { id: "inter", label: "Inter" },
  { id: "roboto", label: "Roboto" },
  { id: "plus-jakarta", label: "Plus Jakarta Sans" }, // default
  { id: "geist", label: "Geist" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans" },
];
