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
import { formatHex8, parse } from "culori";
import {
  chartTokens,
  darkTokens,
  lightTokens,
  radiusBaseRem,
  sidebarDark,
  sidebarLight,
  type ColorTokens,
} from "../src/theme/tokens";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssOut = resolve(__dirname, "../src/theme.css");
const rnOut = resolve(__dirname, "../src/theme.rn.ts");

function toKebab(key: string): string {
  return key.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);
}

function emitCssVars(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `  --${toKebab(k)}: ${v};`)
    .join("\n");
}

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

function emitTokenObject(name: string, tokens: ColorTokens): string {
  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: "${v}",`);
  return `export const ${name}: ColorTokens = {\n${lines.join("\n")}\n};`;
}

const rn = `/* AUTO-GENERATED from packages/shared/src/theme/tokens.ts.
 * Do not edit by hand — run \`npm run theme:generate -w packages/shared\`. */

import type { ColorTokens } from "./theme/tokens";

${emitTokenObject("lightTokensRgb", lightRn)}

${emitTokenObject("darkTokensRgb", darkRn)}
`;

writeFileSync(rnOut, rn);
console.log(`wrote ${rnOut}`);
