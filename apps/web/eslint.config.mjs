import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { translatedCopy } from "../../eslint.i18n.mjs";

// Paths whose interface text is fully in the translation catalog. Add a path
// when it is migrated; `npm run i18n:untranslated` lists what is left.
const TRANSLATED = [
  "components/settings/general/**",
  "components/I18nProvider.tsx",
  "components/scheduled/**",
  "components/auth/**",
  "components/projects/**",
  "components/activity/**",
  "components/library/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...translatedCopy({
    files: ["components/**/*.{ts,tsx}", "spa/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    migrated: TRANSLATED,
  }),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "public/openui/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
    // Gitignored local-only tooling dirs — never lint these.
    ".gemini/**",
    ".claude/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
