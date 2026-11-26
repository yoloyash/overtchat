import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCALE_RESOURCES,
  SUPPORTED_LOCALES,
  i18n,
  parseAppLanguage,
  resolveFormatLocale,
  resolveSupportedLocale,
  setLocale,
} from "../src/i18n/index.ts";
import { formatUpdatedAt } from "../src/relative-time.ts";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** @returns {Record<string, string>} dotted key -> string */
function flatten(value, prefix = "") {
  if (typeof value === "string") return { [prefix]: value };
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    ),
  );
}

/** Plain keys as they are; each plural key as `base_<category>` for the locale's own categories. */
function expectedKeys(english, locale) {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const keys = new Set();
  for (const key of Object.keys(english)) {
    if (!PLURAL_SUFFIX.test(key)) keys.add(key);
    else for (const category of categories) keys.add(key.replace(PLURAL_SUFFIX, `_${category}`));
  }
  return [...keys].sort();
}

/** The variables and `<Trans>` tags a string carries, which a translation must keep. */
const placeholders = (text) =>
  [
    ...[...text.matchAll(/\{\{\s*([^}\s,]+)[^}]*\}\}/g)].map((m) => m[1]),
    ...[...text.matchAll(/<\/?\w+\s*\/?>/g)].map((m) => m[0]),
  ].sort();

const english = flatten(LOCALE_RESOURCES.en);
const translated = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

test("English plural keys come in pairs", () => {
  for (const key of Object.keys(english)) {
    if (!PLURAL_SUFFIX.test(key)) continue;
    const base = key.replace(PLURAL_SUFFIX, "");
    assert.ok(`${base}_one` in english && `${base}_other` in english, `${base} needs _one and _other`);
  }
});

for (const locale of translated) {
  const strings = flatten(LOCALE_RESOURCES[locale]);

  test(`${locale} has exactly the English keys, with its own plural forms`, () => {
    assert.deepEqual(Object.keys(strings).sort(), expectedKeys(english, locale));
  });

  test(`${locale} keeps every variable and tag`, () => {
    for (const [key, text] of Object.entries(strings)) {
      const source = english[key] ?? english[key.replace(PLURAL_SUFFIX, "_other")];
      assert.deepEqual(placeholders(text), placeholders(source), key);
    }
  });

  test(`${locale} has no empty or untranslated strings`, () => {
    const same = [];
    for (const [key, text] of Object.entries(strings)) {
      assert.notEqual(text.trim(), "", key);
      if (text === english[key]) same.push(key);
    }
    // A few strings are legitimately the same (a brand, a unit). Many means a
    // batch was pasted in English.
    assert.ok(
      same.length <= Math.max(3, Object.keys(strings).length * 0.05),
      `${same.length} strings equal English: ${same.slice(0, 10).join(", ")}`,
    );
  });
}

test("English strings do not nest other keys", () => {
  for (const [key, text] of Object.entries(english)) {
    assert.ok(!text.includes("$t("), key);
  }
});

test("the saved language is validated", () => {
  assert.equal(parseAppLanguage("zh-CN"), "zh-CN");
  assert.equal(parseAppLanguage("system"), "system");
  assert.equal(parseAppLanguage("xx"), "system");
  assert.equal(parseAppLanguage(null), "system");
});

test("dates and numbers use the active language, in the device's regional form", () => {
  assert.equal(resolveFormatLocale("en", ["en-GB", "zh-CN"]), "en-GB");
  assert.equal(resolveFormatLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveFormatLocale("zh-CN", ["en-US", "zh-Hans-SG"]), "zh-Hans-SG");
  assert.equal(resolveFormatLocale("zh-CN", ["zh_CN"]), "zh-CN");
  assert.equal(resolveFormatLocale("en", ["zh-TW"]), "en");
  assert.equal(resolveFormatLocale("en", []), "en");
});

test("the system language resolves to a supported locale", () => {
  assert.equal(resolveSupportedLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["en-GB"]), "en");
  assert.equal(resolveSupportedLocale("system", ["zh-CN", "en"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["zh"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["zh-Hans-SG"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["zh_CN"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["zh-TW", "en"]), "en");
  assert.equal(resolveSupportedLocale("system", ["zh-Hant-CN"]), "en");
  assert.equal(resolveSupportedLocale("system", ["fr-FR", "zh-CN"]), "zh-CN");
  assert.equal(resolveSupportedLocale("system", ["fr-FR"]), "en");
  assert.equal(resolveSupportedLocale("system", []), "en");
});

test("the instance starts in English and switches synchronously", () => {
  assert.equal(i18n.language, "en");
  assert.equal(i18n.t("agents.refresh.synced", { count: 1 }), "1 agent workspace synced.");
  assert.equal(i18n.t("agents.refresh.synced", { count: 3 }), "3 agent workspaces synced.");
  const now = new Date(2026, 9, 23, 15, 0).getTime();
  assert.equal(formatUpdatedAt(now - 5 * 60_000, i18n.t, "en-US", now), "5m ago");
  try {
    setLocale("zh-CN");
    assert.equal(i18n.language, "zh-CN");
    assert.equal(i18n.t("agents.refresh.synced", { count: 3 }), "已同步 3 个智能体工作区。");
    assert.equal(formatUpdatedAt(now - 5 * 60_000, i18n.t, "zh-CN", now), "5 分钟前");
  } finally {
    setLocale("en");
  }
});
