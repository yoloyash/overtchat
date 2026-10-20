import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { mobileFonts, radii, type ColorTokens } from "@overtchat/shared";
import { accentPalettesRgb } from "@overtchat/shared/theme.rn";
import { useAccentPref } from "@/lib/accentPref";
import { useThemePref } from "@/lib/appearance";
import { useFontPref } from "@/lib/fontPref";
import { FONT_SANS } from "@/lib/fonts";

export type Theme = {
  colors: ColorTokens;
  radii: typeof radii;
  // Same semantic keys as mobileFonts, but the sans slots are swapped at runtime
  // by the per-device font picker, so the values widen to plain font-family strings.
  fonts: Record<keyof typeof mobileFonts, string>;
  scheme: "light" | "dark";
};

export function useTheme(): Theme {
  const pref = useThemePref();
  const fontId = useFontPref();
  const accentId = useAccentPref();
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const scheme = pref === "system" ? system : pref;
  const colors = accentPalettesRgb[accentId][scheme];
  const fonts = useMemo(
    () => ({ ...mobileFonts, ...FONT_SANS[fontId] }),
    [fontId],
  );

  return useMemo(
    () => ({ colors, radii, fonts, scheme }),
    [colors, fonts, scheme],
  );
}
