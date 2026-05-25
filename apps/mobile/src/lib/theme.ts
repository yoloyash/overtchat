import { useColorScheme } from "react-native";
import { mobileFonts, radii, type ColorTokens } from "@overtchat/shared";
import { darkTokensRgb, lightTokensRgb } from "@overtchat/shared/theme.rn";
import { useThemePref } from "@/lib/appearance";

export type Theme = {
  colors: ColorTokens;
  radii: typeof radii;
  fonts: typeof mobileFonts;
  scheme: "light" | "dark";
};

export function useTheme(): Theme {
  const pref = useThemePref();
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const scheme = pref === "system" ? system : pref;
  return {
    colors: scheme === "dark" ? darkTokensRgb : lightTokensRgb,
    radii,
    fonts: mobileFonts,
    scheme,
  };
}
