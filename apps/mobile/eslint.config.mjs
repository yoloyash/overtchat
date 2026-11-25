import tseslint from "typescript-eslint";
import { translatedCopy } from "../../eslint.i18n.mjs";

// Paths whose interface text is fully in the translation catalog. Add a path
// when it is migrated; `npm run i18n:untranslated` lists what is left.
const TRANSLATED = [
  "src/app/(authed)/settings/appearance.tsx",
  "src/components/I18nProvider.tsx",
  "src/components/ui/AccentPicker.tsx",
  "src/app/(authed)/(drawer)/agent/**",
  "src/app/(authed)/(drawer)/agents/**",
  "src/components/agents/**",
  "src/lib/agents/**",
];

// The typecheck covers code quality here; this config only parses TypeScript
// so the translation rules can read it. Existing comments switch off a
// react-hooks rule that is not installed, so it is declared as a no-op.
const reactHooks = { rules: { "exhaustive-deps": { create: () => ({}) } } };

export default tseslint.config(
  { ignores: ["android/**", "ios/**", ".expo/**", "modules/**", "plugins/**", "scripts/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  ...translatedCopy({ files: ["src/**/*.{ts,tsx}"], migrated: TRANSLATED }),
);
