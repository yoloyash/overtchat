/**
 * Generates theme outputs from `src/theme/tokens.ts`:
 *   - `src/theme.css`  — `oklch()` values for web (consumed by Tailwind v4)
 *   - `src/theme.rn.ts` — sRGB hex values for React Native, which can't parse
 *                         CSS Color Level 4 functional notation. Same key
 *                         shape as the source TS tokens, just hex strings.
 *
 * Run via `npm run theme:generate -w packages/shared` after edits to tokens.
 * Both outputs are committed so consumers don't need a build step.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { converter, formatCss, formatHex8, parse } from "culori";
import {
  ACCENT_OPTIONS,
  DEFAULT_ACCENT_ID,
  chartTokens,
  darkTokens,
  lightTokens,
  radiusBaseRem,
  sidebarDark,
  sidebarLight,
  type ColorTokens,
  type AccentId,
  type SidebarTokens,
} from "../src/theme/tokens";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssOut = resolve(__dirname, "../src/theme.css");
const rnOut = resolve(__dirname, "../src/theme.rn.ts");

const toOklch = converter("oklch");

/** Palette generation stays build-time only; apps consume the generated colors. */
function tintTokens<T extends ColorTokens | SidebarTokens>(tokens: T, id: AccentId): T {
  if (id === DEFAULT_ACCENT_ID) return tokens;
  const { hue } = ACCENT_OPTIONS.find((option) => option.id === id)!;
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => {
    const color = toOklch(value);
    if (!color) throw new Error(`Invalid theme color: ${key}=${value}`);
    // Keep semantic danger colors and achromatic borders intact.
    if (key === "destructive" || color.c === 0) return [key, value];
    return [key, formatCss({ ...color, h: hue, c: id === "neutral" ? 0 : color.c })];
  })) as T;
}

function accentPalette(id: AccentId) {
  return {
    light: tintTokens(lightTokens, id),
    dark: tintTokens(darkTokens, id),
    sidebarLight: tintTokens(sidebarLight, id),
    sidebarDark: tintTokens(sidebarDark, id),
  };
}

function toKebab(key: string): string {
  return key.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);
}

function emitCssVars(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `  --${toKebab(k)}: ${v};`)
    .join("\n");
}

const accentCss = ACCENT_OPTIONS
  .filter(({ id }) => id !== DEFAULT_ACCENT_ID)
  .map(({ id }) => {
    const palette = accentPalette(id);
    return `:root[data-accent="${id}"] {
${emitCssVars(palette.light)}
${emitCssVars(palette.sidebarLight)}
}

:root.dark[data-accent="${id}"] {
${emitCssVars(palette.dark)}
${emitCssVars(palette.sidebarDark)}
}`;
  })
  .join("\n\n");

const css = `/* AUTO-GENERATED from packages/shared/src/theme/tokens.ts.
 * Do not edit by hand — run \`npm run theme:generate -w packages/shared\`. */

:root {
${[
  emitCssVars(lightTokens),
  emitCssVars(chartTokens),
  `  --radius: ${radiusBaseRem}rem;`,
  emitCssVars(sidebarLight),
].join("\n")}
}

.dark {
${[emitCssVars(darkTokens), emitCssVars(chartTokens), emitCssVars(sidebarDark)].join("\n")}
}

${accentCss}
`;

writeFileSync(cssOut, css);
console.log(`wrote ${cssOut}`);

/**
 * Convert an `oklch(...)` (or any CSS color string culori parses) to an sRGB
 * hex string. Out-of-gamut colors are clipped via culori's hex formatter, which
 * matches what every browser does when rendering oklch on an sRGB display.
 *
 * Always emits 8-char `#rrggbbaa` so RN gets a uniform format.
 */
function toRnHex(input: string): string {
  const parsed = parse(input);
  if (!parsed) {
    throw new Error(`could not parse color: ${input}`);
  }
  const hex = formatHex8(parsed);
  if (!hex) {
    throw new Error(`could not format color to hex: ${input}`);
  }
  return hex;
}

function convertTokens(tokens: ColorTokens): ColorTokens {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) {
    out[k] = toRnHex(v);
  }
  return out as ColorTokens;
}

const lightRn = convertTokens(lightTokens);
const darkRn = convertTokens(darkTokens);
const accentRn = Object.fromEntries(ACCENT_OPTIONS.map(({ id }) => {
  const palette = accentPalette(id);
  return [id, { light: convertTokens(palette.light), dark: convertTokens(palette.dark) }];
}));
const swatchesRn = Object.fromEntries(
  ACCENT_OPTIONS.map(({ id, swatch }) => [id, toRnHex(swatch)]),
);

function emitTokenObject(name: string, tokens: ColorTokens): string {
  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: "${v}",`);
  return `export const ${name}: ColorTokens = {\n${lines.join("\n")}\n};`;
}

const rn = `/* AUTO-GENERATED from packages/shared/src/theme/tokens.ts.
 * Do not edit by hand — run \`npm run theme:generate -w packages/shared\`. */

import type { AccentId, ColorTokens } from "./theme/tokens";

${emitTokenObject("lightTokensRgb", lightRn)}

${emitTokenObject("darkTokensRgb", darkRn)}

export const accentPalettesRgb: Record<AccentId, { light: ColorTokens; dark: ColorTokens }> = ${JSON.stringify(accentRn, null, 2)};

export const accentSwatchesRgb: Record<AccentId, string> = ${JSON.stringify(swatchesRn, null, 2)};
`;

writeFileSync(rnOut, rn);
console.log(`wrote ${rnOut}`);
