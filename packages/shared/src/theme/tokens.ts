/**
 * Design tokens. Single source of truth for both web and mobile.
 *
 * Web reads these via the generated `theme.css` next to this file
 * (run `npm run theme:generate -w packages/shared` after edits).
 * Mobile imports the TS objects directly via `useTheme()`.
 *
 * Color values use the `oklch(...)` literal form. RN 0.85 accepts this
 * literal verbatim, so values transfer 1:1 to mobile without conversion.
 */

export type ColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
};

export const lightTokens: ColorTokens = {
  background: "oklch(0.992 0.004 120)",
  foreground: "oklch(0.20 0.018 120)",
  card: "oklch(0.992 0.004 120)",
  cardForeground: "oklch(0.20 0.018 120)",
  popover: "oklch(0.998 0.003 120)",
  popoverForeground: "oklch(0.20 0.018 120)",
  primary: "oklch(0.30 0.035 120)",
  primaryForeground: "oklch(0.98 0.005 120)",
  secondary: "oklch(0.93 0.018 120)",
  secondaryForeground: "oklch(0.22 0.020 120)",
  muted: "oklch(0.96 0.010 120)",
  mutedForeground: "oklch(0.48 0.020 120)",
  accent: "oklch(0.91 0.022 120)",
  accentForeground: "oklch(0.22 0.020 120)",
  destructive: "oklch(0.577 0.245 27.325)",
  border: "oklch(0.89 0.014 120)",
  input: "oklch(0.89 0.014 120)",
  ring: "oklch(0.55 0.10 120)",
};

export const darkTokens: ColorTokens = {
  background: "oklch(0.17 0.014 120)",
  foreground: "oklch(0.96 0.005 120)",
  card: "oklch(0.22 0.018 120)",
  cardForeground: "oklch(0.96 0.005 120)",
  popover: "oklch(0.22 0.018 120)",
  popoverForeground: "oklch(0.96 0.005 120)",
  primary: "oklch(0.88 0.020 120)",
  primaryForeground: "oklch(0.22 0.020 120)",
  secondary: "oklch(0.30 0.025 120)",
  secondaryForeground: "oklch(0.96 0.005 120)",
  muted: "oklch(0.26 0.018 120)",
  mutedForeground: "oklch(0.68 0.020 120)",
  accent: "oklch(0.32 0.030 120)",
  accentForeground: "oklch(0.96 0.005 120)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.60 0.09 120)",
};

/**
 * Web-only extras. Mobile doesn't render charts or a sidebar, so these
 * stay separate from the small core surface mobile imports — but they're
 * still emitted into theme.css so web's existing `@theme inline` block
 * keeps working without changes.
 */
export type ChartTokens = {
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
};

export const chartTokens: ChartTokens = {
  chart1: "oklch(0.87 0 0)",
  chart2: "oklch(0.556 0 0)",
  chart3: "oklch(0.439 0 0)",
  chart4: "oklch(0.371 0 0)",
  chart5: "oklch(0.269 0 0)",
};

export type SidebarTokens = {
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
};

export const sidebarLight: SidebarTokens = {
  sidebar: "oklch(0.975 0.008 120)",
  sidebarForeground: "oklch(0.22 0.018 120)",
  sidebarPrimary: "oklch(0.30 0.035 120)",
  sidebarPrimaryForeground: "oklch(0.98 0.005 120)",
  sidebarAccent: "oklch(0.91 0.022 120)",
  sidebarAccentForeground: "oklch(0.22 0.020 120)",
  sidebarBorder: "oklch(0.89 0.014 120)",
  sidebarRing: "oklch(0.55 0.10 120)",
};

export const sidebarDark: SidebarTokens = {
  sidebar: "oklch(0.22 0.018 120)",
  sidebarForeground: "oklch(0.96 0.005 120)",
  sidebarPrimary: "oklch(0.60 0.09 120)",
  sidebarPrimaryForeground: "oklch(0.16 0.014 120)",
  sidebarAccent: "oklch(0.30 0.025 120)",
  sidebarAccentForeground: "oklch(0.96 0.005 120)",
  sidebarBorder: "oklch(1 0 0 / 10%)",
  sidebarRing: "oklch(0.60 0.09 120)",
};

/**
 * Base radius is 0.625rem (10px at default 16px root). Web derives the
 * scale via Tailwind's `--radius-*` calc()s; mobile gets numeric pixels.
 */
export const radiusBaseRem = 0.625;

export const radii = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  xxl: 18,
  pill: 9999,
} as const;

/**
 * Web font-family strings (consumed by `apps/web/app/layout.tsx` via next/font).
 */
export const webFonts = {
  sans: "Plus Jakarta Sans",
  serif: "Fraunces",
  mono: "Geist Mono",
} as const;

/**
 * Mobile font-family keys. RN doesn't synthesize weights from a single family —
 * each weight is its own registered family. These keys must match what
 * `apps/mobile/src/app/_layout.tsx` registers via `useFonts({...})`.
 */
export const mobileFonts = {
  sansRegular: "PlusJakartaSans_400Regular",
  sansMedium: "PlusJakartaSans_500Medium",
  sansSemiBold: "PlusJakartaSans_600SemiBold",
  serifSemiBold: "Fraunces_600SemiBold",
} as const;

/** @deprecated kept for API stability — prefer `webFonts` or `mobileFonts`. */
export const fontFamilies = webFonts;
