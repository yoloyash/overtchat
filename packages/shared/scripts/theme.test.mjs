import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatHex8, wcagContrast } from "culori";
import { accentPalettesRgb, accentSwatchesRgb, darkTokensRgb, lightTokensRgb } from "../src/theme.rn.ts";
import { ACCENT_OPTIONS, DEFAULT_ACCENT_ID, resolveAccentId } from "../src/theme/tokens.ts";
import { accentBackgrounds } from "../src/theme.backgrounds.ts";

const css = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
const cssRules = new Map(Array.from(css.matchAll(/([^{}]+)\{([^{}]+)\}/g), ([, selector, body]) => [
  selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  Object.fromEntries(Array.from(body.matchAll(/--([\w-]+):\s*([^;]+);/g), ([, key, value]) => [key, value])),
]));

test("unknown stored accents safely resolve to the default", () => {
  for (const input of [undefined, null, "invalid", "__proto__", {}, 1]) {
    assert.equal(resolveAccentId(input), DEFAULT_ACCENT_ID);
  }
});

test("the default native palette remains the original light/dark theme", () => {
  assert.deepEqual(accentPalettesRgb.olive, { light: lightTokensRgb, dark: darkTokensRgb });
});

const textPairs = [
  ["foreground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["primaryForeground", "primary"],
  ["secondaryForeground", "secondary"],
  ["accentForeground", "accent"],
  ["mutedForeground", "muted"],
];

for (const { id, swatch } of ACCENT_OPTIONS) {
  test(`${id}: generated web/native colors agree and preserve contrast`, () => {
    assert.equal(accentSwatchesRgb[id], formatHex8(swatch));
    for (const scheme of ["light", "dark"]) {
      const colors = accentPalettesRgb[id][scheme];
      assert.equal(accentBackgrounds[id][scheme], colors.background.slice(0, 7));
      const base = cssRules.get(scheme === "light" ? ":root" : ".dark");
      const selector = `:root${scheme === "dark" ? ".dark" : ""}[data-accent="${id}"]`;
      if (id !== DEFAULT_ACCENT_ID) assert.ok(cssRules.has(selector), selector);
      const web = { ...base, ...cssRules.get(selector) };
      for (const [key, native] of Object.entries(colors)) {
        const cssKey = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        assert.equal(formatHex8(web[cssKey]), native, `${scheme} ${key}`);
      }
      assert.equal(colors.destructive, accentPalettesRgb.olive[scheme].destructive);
      for (const [fg, bg] of textPairs) {
        assert.ok(wcagContrast(colors[fg], colors[bg]) >= 4.5, `${scheme} ${fg}/${bg}`);
      }
      for (const suffix of ["", "-primary", "-accent"]) {
        assert.ok(wcagContrast(web[`sidebar${suffix}-foreground`], web[`sidebar${suffix}`]) >= 4.5);
      }
      // Focus outlines and the selected tile border need non-text contrast.
      for (const bg of ["background", "card", "accent"]) {
        assert.ok(wcagContrast(colors.ring, colors[bg]) >= 3, `${scheme} ring/${bg}`);
      }
    }
  });
}
