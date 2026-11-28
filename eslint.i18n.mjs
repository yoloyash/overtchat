/**
 * Lint rules that keep interface text in the translation catalog. See
 * docs/development.md#translations.
 *
 * A client lists the paths it has migrated; text written straight into those
 * files is an error. `I18N_AUDIT=1` checks every path instead, which is how
 * `npm run i18n:untranslated` counts what is left.
 */
import i18next from "eslint-plugin-i18next";

/** Props whose value a person reads or hears. */
const VISIBLE_PROPS = [
  "title",
  "subtitle",
  "description",
  "label",
  "placeholder",
  "alt",
  "tooltip",
  "message",
  "hint",
  "emptyText",
  "confirmLabel",
  "cancelLabel",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "accessibilityLabel",
  "accessibilityHint",
  "headerTitle",
  "headerBackTitle",
];

/** Calls that show their text arguments: toasts and native alerts. */
const NOTICE_CALLS = [
  "CallExpression[callee.object.name='toast']",
  "CallExpression[callee.name=/^toast[A-Z]/]",
  "CallExpression[callee.object.name='Alert'][callee.property.name=/^(alert|prompt)$/]",
].join(", ");
const LITERAL_TEXT = ":matches(Literal[value=/[A-Za-z]{2}/], TemplateLiteral)";

/**
 * @param {{ files: string[], migrated: string[] }} options `files` is every
 * path that can hold interface text; `migrated` the ones already translated.
 */
export function translatedCopy({ files, migrated }) {
  const audit = process.env.I18N_AUDIT === "1";
  const checked = audit ? files : migrated;
  if (checked.length === 0) return [];
  return [
    {
      files: checked,
      ignores: ["**/*.test.*", "**/*.spec.*"],
      plugins: { i18next },
      rules: {
        "i18next/no-literal-string": [
          "error",
          {
            mode: "jsx-only",
            "jsx-attributes": { include: VISIBLE_PROPS },
            message: "Interface text belongs in the translation catalog; use t().",
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: `:matches(${NOTICE_CALLS}) > ${LITERAL_TEXT}`,
            message: "Interface text belongs in the translation catalog; use t().",
          },
          {
            selector: `:matches(${NOTICE_CALLS}) > ObjectExpression > Property[key.name=/^(title|description|message|label)$/] > ${LITERAL_TEXT}`,
            message: "Interface text belongs in the translation catalog; use t().",
          },
        ],
      },
    },
  ];
}
