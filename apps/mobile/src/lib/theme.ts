import { useColorScheme } from "react-native";
import { mobileFonts, radii, type ColorTokens } from "@overtchat/shared";
import { darkTokensRgb, lightTokensRgb } from "@overtchat/shared/theme.rn";

export type Theme = {
  colors: ColorTokens;
  radii: typeof radii;
  fonts: typeof mobileFonts;
  scheme: "light" | "dark";
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return {
    colors: scheme === "dark" ? darkTokensRgb : lightTokensRgb,
    radii,
    fonts: mobileFonts,
    scheme,
  };
}
